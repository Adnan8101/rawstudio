const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const axios = require('axios');
const geoip = require('geoip-lite');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// CRITICAL: Enable trust proxy for accurate IP detection
app.set('trust proxy', true);
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve the main HTML file at root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// MongoDB connection with connection reuse for Vercel
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/rawstudio';
let db;
let cachedClient = null;

// ✅ FIXED: Updated MongoDB connection options (removed deprecated bufferMaxEntries)
async function connectToDatabase() {
    if (cachedClient && db) {
        return { client: cachedClient, db };
    }

    try {
        const client = await MongoClient.connect(MONGODB_URI, {
            // ✅ Modern connection options (compatible with latest MongoDB driver)
            maxPoolSize: 10,                    // Maximum number of connections
            serverSelectionTimeoutMS: 5000,    // Timeout for server selection
            socketTimeoutMS: 45000,            // Socket timeout
            connectTimeoutMS: 10000,           // Connection timeout
            maxIdleTimeMS: 30000,              // Close connections after 30s idle
            // ✅ Removed deprecated options:
            // - bufferMaxEntries (not supported)
            // - useNewUrlParser (deprecated)  
            // - useUnifiedTopology (deprecated)
        });
        
        console.log('✅ Connected to MongoDB');
        cachedClient = client;
        db = client.db('rawstudio');
        
        // Create indexes for better performance (only if not exists)
        try {
            await db.collection('visitors').createIndex({ timestamp: -1 });
            await db.collection('visitors').createIndex({ ipv4: 1 });
            await db.collection('visitors').createIndex({ 'location.country': 1 });
        } catch (indexError) {
            // Indexes might already exist
        }
        
        return { client, db };
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        return { client: null, db: null };
    }
}

// Initialize connection on first request
connectToDatabase();

// Load VPN/Proxy IP ranges
let torExitNodes = new Set();
let vpnRanges = new Set();

// Load free VPN/Proxy databases on startup
async function loadVPNDatabases() {
    try {
        console.log('📡 Loading VPN/Proxy detection databases...');
        await loadTorExitNodes();
        console.log(`✅ Loaded ${torExitNodes.size} Tor exit nodes`);
    } catch (error) {
        console.error('⚠️ Error loading VPN databases:', error);
    }
}

async function loadTorExitNodes() {
    try {
        const response = await axios.get('https://check.torproject.org/cgi-bin/TorBulkExitList.py?ip=1.1.1.1', {
            timeout: 10000
        });
        
        const exitNodes = response.data.split('\n').filter(ip => ip && !ip.startsWith('#'));
        exitNodes.forEach(ip => torExitNodes.add(ip.trim()));
    } catch (error) {
        console.log('⚠️ Could not load Tor exit nodes, using fallback detection');
    }
}

// Initialize databases
loadVPNDatabases();

// ENHANCED IP DETECTION FUNCTION
function getRealIP(req) {
    console.log('🔍 IP Detection Debug Info:');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Connection info:', {
        remoteAddress: req.connection?.remoteAddress,
        socketRemoteAddress: req.socket?.remoteAddress,
        reqIP: req.ip,
        reqIPs: req.ips
    });

    // Method 1: Express.js built-in (works with trust proxy)
    if (req.ip && req.ip !== '::1' && req.ip !== '127.0.0.1' && !req.ip.startsWith('::ffff:127.0.0.1')) {
        console.log('✅ Using Express req.ip:', req.ip);
        return req.ip.replace(/^::ffff:/, ''); // Remove IPv4-mapped IPv6 prefix
    }

    // Method 2: Multiple proxy headers (comprehensive list)
    const proxyHeaders = [
        'cf-connecting-ip',           // Cloudflare
        'cf-pseudo-ipv4',            // Cloudflare IPv4
        'x-forwarded-for',           // Standard proxy header
        'x-real-ip',                 // Nginx proxy
        'x-client-ip',               // Apache
        'x-forwarded',               // Proxy
        'x-cluster-client-ip',       // Cluster
        'forwarded-for',             // Forwarded
        'forwarded',                 // RFC 7239
        'true-client-ip',            // Akamai, Cloudflare
        'x-original-forwarded-for',  // Original forwarded
        'x-appengine-remote-addr',   // Google App Engine
        'x-azure-clientip',          // Azure
        'x-azure-socketip'           // Azure Socket
    ];

    for (const header of proxyHeaders) {
        const value = req.headers[header];
        if (value) {
            // Handle comma-separated list (take first IP)
            const ip = value.split(',').trim();
            
            // Validate IP format and exclude local/invalid IPs
            if (isValidPublicIP(ip)) {
                console.log(`✅ Using header ${header}:`, ip);
                return ip;
            }
        }
    }

    // Method 3: Connection/Socket info
    const connectionIPs = [
        req.connection?.remoteAddress,
        req.socket?.remoteAddress,
        req.connection?.socket?.remoteAddress
    ];

    for (const ip of connectionIPs) {
        if (ip && isValidPublicIP(ip)) {
            console.log('✅ Using connection IP:', ip);
            return ip.replace(/^::ffff:/, '');
        }
    }

    // Method 4: Get public IP using external service as fallback
    console.log('⚠️ Could not determine IP from headers, using fallback');
    return 'unknown';
}

// Helper function to validate if IP is public and valid
function isValidPublicIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    
    // Remove IPv6 prefix if present
    const cleanIP = ip.replace(/^::ffff:/, '');
    
    // Basic IP format validation
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    
    if (!ipv4Regex.test(cleanIP) && !ipv6Regex.test(cleanIP)) {
        return false;
    }
    
    // Exclude local/private IP ranges
    const privateRanges = [
        /^127\./,                    // Localhost
        /^10\./,                     // Private Class A
        /^172\.(1[6-9]|2[0-9]|3[21])\./, // Private Class B
        /^192\.168\./,               // Private Class C
        /^169\.254\./,               // Link-local
        /^::1$/,                     // IPv6 localhost
        /^fe80:/,                    // IPv6 link-local
        /^fc00:/,                    // IPv6 unique local
        /^fd00:/                     // IPv6 unique local
    ];
    
    for (const range of privateRanges) {
        if (range.test(cleanIP)) {
            return false;
        }
    }
    
    return true;
}

// Get additional IP info using external services
async function getExternalIPInfo(req) {
    try {
        // Try multiple IP detection services
        const services = [
            'https://api.ipify.org?format=json',
            'https://httpbin.org/ip',
            'https://api.my-ip.io/ip.json',
            'https://ipapi.co/json/',
            'https://ip.seeip.org/jsonip'
        ];

        for (const service of services) {
            try {
                const response = await axios.get(service, { 
                    timeout: 3000,
                    headers: {
                        'User-Agent': 'Raw-Studio-Analytics/1.0',
                        'X-Forwarded-For': req.headers['x-forwarded-for'] || '',
                        'X-Real-IP': req.headers['x-real-ip'] || ''
                    }
                });
                
                let ip = null;
                if (response.data.ip) ip = response.data.ip;
                else if (response.data.origin) ip = response.data.origin;
                else if (typeof response.data === 'string') ip = response.data.trim();
                
                if (ip && isValidPublicIP(ip)) {
                    console.log(`✅ External service ${service} detected IP:`, ip);
                    return ip;
                }
            } catch (serviceError) {
                console.log(`⚠️ Service ${service} failed:`, serviceError.message);
                continue;
            }
        }
    } catch (error) {
        console.error('❌ All external IP services failed:', error);
    }
    
    return null;
}

// Enhanced VPN/Proxy detection
async function detectVPNProxy(ip) {
    try {
        let isVPN = false;
        let vpnType = 'none';
        let confidence = 0;
        let detectionMethods = [];

        // Method 1: Check against Tor exit nodes
        if (torExitNodes.has(ip)) {
            isVPN = true;
            vpnType = 'tor';
            confidence = 0.95;
            detectionMethods.push('tor_exit_node');
        }

        // Method 2: GeoIP-based detection
        const geo = geoip.lookup(ip);
        if (geo && geo.org) {
            const org = geo.org.toLowerCase();
            const vpnIndicators = [
                'amazon', 'google', 'microsoft', 'digitalocean', 'vultr',
                'linode', 'ovh', 'hetzner', 'vpn', 'proxy', 'hosting',
                'server', 'datacenter', 'cloud', 'virtual', 'dedicated'
            ];
            
            const foundIndicator = vpnIndicators.find(indicator => org.includes(indicator));
            if (foundIndicator) {
                isVPN = true;
                vpnType = foundIndicator.includes('vpn') ? 'vpn' : 'hosting/proxy';
                confidence = Math.max(confidence, 0.7);
                detectionMethods.push('isp_analysis');
            }
        }

        // Method 3: Free GetIPIntel.net check
        try {
            const getipintelResponse = await axios.get(
                `https://check.getipintel.net/check.php?ip=${ip}&contact=${process.env.ADMIN_EMAIL || 'admin@rawstudio.com'}&format=json&flags=m`,
                { timeout: 5000 }
            );
            
            if (getipintelResponse.data && typeof getipintelResponse.data.result === 'number') {
                const score = parseFloat(getipintelResponse.data.result);
                if (score > 0.5) {
                    isVPN = true;
                    vpnType = score > 0.8 ? 'vpn' : 'proxy';
                    confidence = Math.max(confidence, score);
                    detectionMethods.push('getipintel');
                }
            }
        } catch (error) {
            // GetIPIntel might be rate limited
        }

        return {
            isVPN,
            vpnType,
            confidence: Math.min(confidence, 1.0),
            detectionMethods,
            details: {
                torNode: torExitNodes.has(ip),
                organization: geo?.org || 'Unknown',
                asn: geo?.as || 'Unknown'
            }
        };
    } catch (error) {
        console.error('❌ VPN detection error:', error);
        return {
            isVPN: false,
            vpnType: 'unknown',
            confidence: 0,
            detectionMethods: ['error'],
            details: { error: error.message }
        };
    }
}

// Enhanced location information - FIXED coordinate extraction
function getLocationInfo(ip) {
    const geo = geoip.lookup(ip);
    if (!geo) {
        return {
            country: 'Unknown',
            region: 'Unknown',
            city: 'Unknown',
            timezone: 'Unknown',
            coordinates: { lat: 0, lng: 0 },
            isp: 'Unknown',
            asn: 'Unknown',
            mapUrl: null
        };
    }
    
    // ✅ FIXED: Properly extract latitude and longitude
    const lat = geo.ll && geo.ll[0] ? geo.ll[0] : 0;
    const lng = geo.ll && geo.ll[1] ? geo.ll[1] : 0;
    
    // ✅ Generate direct Google Maps URL
    const mapUrl = lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : null;
    
    return {
        country: geo.country || 'Unknown',
        region: geo.region || 'Unknown',
        city: geo.city || 'Unknown',
        timezone: geo.timezone || 'Unknown',
        coordinates: {
            lat: lat,
            lng: lng
        },
        isp: geo.org || 'Unknown',
        asn: geo.as || 'Unknown',
        mapUrl: mapUrl  // ✅ Direct map link ready to use
    };
}


// Track visitor endpoint with enhanced detection
app.post('/api/track-visitor', async (req, res) => {
    try {
        console.log('\n🎯 === NEW VISITOR TRACKING REQUEST ===');
        
        // Ensure database connection
        await connectToDatabase();
        
        // Get IP using enhanced detection
        let ipv4 = getRealIP(req);
        
        // If IP detection failed, try external services
        if (!ipv4 || ipv4 === 'unknown' || !isValidPublicIP(ipv4)) {
            console.log('🔄 Trying external IP detection services...');
            const externalIP = await getExternalIPInfo(req);
            if (externalIP) {
                ipv4 = externalIP;
            } else {
                ipv4 = 'unknown';
            }
        }

        console.log('🎯 Final detected IP:', ipv4);

        const userAgent = req.headers['user-agent'];
        const referer = req.headers.referer;
        const timestamp = new Date();
        
        // Get IPv6 if available
        const forwarded = req.headers['x-forwarded-for'] || '';
        const ipv6 = forwarded.split(',').find(ip => ip.includes(':'))?.trim() || null;
        
        // Get location information
        const location = getLocationInfo(ipv4);
        console.log('📍 Location detected:', location);
        
        // Detect VPN/Proxy
        const vpnInfo = await detectVPNProxy(ipv4);
        console.log('🛡️ VPN Info:', vpnInfo);
        
        // Get additional browser/device info
        const browserInfo = {
            userAgent,
            language: req.headers['accept-language']?.split(',') || 'Unknown',
            referer: referer || 'Direct',
            acceptEncoding: req.headers['accept-encoding'] || 'Unknown'
        };
        
        // Create visitor record
        const visitorData = {
            ipv4,
            ipv6,
            location,
            vpnInfo,
            browserInfo,
            timestamp,
            sessionId: req.body.sessionId || Date.now().toString(),
            rawHeaders: req.headers, // Store all headers for debugging
            detectionMethod: 'enhanced'
        };
        
        // Insert into MongoDB if available
        if (db) {
            await db.collection('visitors').insertOne(visitorData);
            console.log('💾 Visitor data saved to MongoDB');
        } else {
            console.log('⚠️ MongoDB not available, visitor data not saved');
        }
        
        console.log(`✅ Visitor tracked: ${ipv4} from ${location.city}, ${location.country} ${vpnInfo.isVPN ? '(🚨 VPN detected)' : '(✅ Clean IP)'}`);
        console.log('=== END VISITOR TRACKING ===\n');
        
        res.json({ 
            success: true, 
            message: 'Visitor tracked successfully',
            detectedIP: ipv4,
            location: location.city + ', ' + location.country,
            vpnDetected: vpnInfo.isVPN
        });
    } catch (error) {
        console.error('❌ Error tracking visitor:', error);
        res.status(500).json({ success: false, error: 'Failed to track visitor' });
    }
});

// Debug endpoint to test IP detection
app.get('/api/debug/ip', async (req, res) => {
    console.log('\n🔧 === IP DEBUG REQUEST ===');
    
    const ipv4 = getRealIP(req);
    const externalIP = await getExternalIPInfo(req);
    const location = getLocationInfo(ipv4);
    const vpnInfo = await detectVPNProxy(ipv4);
    
    const debugInfo = {
        detectedIP: ipv4,
        externalIP: externalIP,
        expressIP: req.ip,
        expressIPs: req.ips,
        headers: req.headers,
        location,
        vpnInfo,
        isValidPublicIP: isValidPublicIP(ipv4),
        timestamp: new Date()
    };
    
    console.log('🔧 Debug Info:', JSON.stringify(debugInfo, null, 2));
    console.log('=== END IP DEBUG ===\n');
    
    res.json(debugInfo);
});

// Admin authentication
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const ADMIN_PASSWORD = 'AQGM@8433';
    
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, token: 'admin-authenticated' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

// Get analytics data
app.get('/api/admin/analytics', async (req, res) => {
    try {
        await connectToDatabase();
        
        if (!db) {
            return res.json({
                totalVisitors: 0,
                todayVisitors: 0,
                uniqueCountries: 0,
                vpnUsers: 0,
                error: 'Database not available'
            });
        }

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        const totalVisitors = await db.collection('visitors').countDocuments();
        const todayVisitors = await db.collection('visitors').countDocuments({
            timestamp: { $gte: today }
        });
        
        const countries = await db.collection('visitors').distinct('location.country');
        const uniqueCountries = countries.filter(c => c !== 'Unknown').length;
        
        const vpnUsers = await db.collection('visitors').countDocuments({
            'vpnInfo.isVPN': true
        });
        
        res.json({
            totalVisitors,
            todayVisitors,
            uniqueCountries,
            vpnUsers
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// Get recent visitors
app.get('/api/admin/recent-visitors', async (req, res) => {
    try {
        await connectToDatabase();
        
        if (!db) {
            return res.json([]);
        }

        const limit = parseInt(req.query.limit) || 50;
        
        const visitors = await db.collection('visitors')
            .find({})
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
        
        res.json(visitors);
    } catch (error) {
        console.error('Error fetching recent visitors:', error);
        res.status(500).json({ error: 'Failed to fetch recent visitors' });
    }
});

// Get location statistics
app.get('/api/admin/location-stats', async (req, res) => {
    try {
        await connectToDatabase();
        
        if (!db) {
            return res.json([]);
        }

        const locationStats = await db.collection('visitors').aggregate([
            {
                $group: {
                    _id: '$location.country',
                    count: { $sum: 1 },
                    cities: { $addToSet: '$location.city' }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]).toArray();
        
        res.json(locationStats);
    } catch (error) {
        console.error('Error fetching location stats:', error);
        res.status(500).json({ error: 'Failed to fetch location stats' });
    }
});

// Get timeline data
app.get('/api/admin/timeline', async (req, res) => {
    try {
        await connectToDatabase();
        
        if (!db) {
            return res.json([]);
        }

        const filter = req.query.filter || '24h';
        let dateRange;
        
        const now = new Date();
        switch (filter) {
            case '24h':
                dateRange = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case '7d':
                dateRange = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                dateRange = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                dateRange = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        }
        
        const timelineData = await db.collection('visitors').aggregate([
            { $match: { timestamp: { $gte: dateRange } } },
            {
                $group: {
                    _id: {
                        year: { $year: '$timestamp' },
                        month: { $month: '$timestamp' },
                        day: { $dayOfMonth: '$timestamp' },
                        hour: filter === '24h' ? { $hour: '$timestamp' } : null
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } }
        ]).toArray();
        
        res.json(timelineData);
    } catch (error) {
        console.error('Error fetching timeline data:', error);
        res.status(500).json({ error: 'Failed to fetch timeline data' });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date(),
        database: db ? 'connected' : 'disconnected',
        trustProxy: app.get('trust proxy')
    });
});

// ✅ Export app instead of listening (for Vercel)
module.exports = app;

// For local development, still allow app.listen
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 ================================`);
        console.log(`✅ Server running on http://localhost:${PORT}`);
        console.log(`📁 Serving static files from: ${path.join(__dirname, 'public')}`);
        console.log(`🔒 Enhanced IP detection with VPN/Proxy detection active`);
        console.log(`🌐 Admin dashboard available via shield icon`);
        console.log(`🔧 Debug IP detection at: http://localhost:${PORT}/api/debug/ip`);
        console.log(`🗑️ Clean database with: npm run clean`);
        console.log(`================================\n`);
    });
}
