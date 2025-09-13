const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const axios = require('axios');
const geoip = require('geoip-lite');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Enhanced trust proxy configuration for Vercel
app.set('trust proxy', true);
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://raw-studio.vercel.app', 'https://your-custom-domain.com']
    : ['http://localhost:3001', 'http://127.0.0.1:3001'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint (important for Vercel)
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date(),
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0'
    });
});

// Serve the main HTML file at root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// MongoDB connection with enhanced error handling
const MONGODB_URI = process.env.MONGODB_URI;
let db;
let isConnected = false;

async function connectToDatabase() {
    if (isConnected && db) {
        return db;
    }

    try {
        const client = new MongoClient(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        await client.connect();
        db = client.db('rawstudio');
        isConnected = true;
        
        console.log('✅ Connected to MongoDB Atlas');
        
        // Create indexes for better performance
        try {
            await db.collection('visitors').createIndex({ timestamp: -1 });
            await db.collection('visitors').createIndex({ ipv4: 1 });
            await db.collection('visitors').createIndex({ 'location.country': 1 });
        } catch (indexError) {
            console.log('⚠️ Index creation warning:', indexError.message);
        }
        
        return db;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        isConnected = false;
        throw error;
    }
}

// Initialize database connection
connectToDatabase().catch(console.error);

// Load VPN/Proxy data
let torExitNodes = new Set();

async function loadVPNDatabases() {
    try {
        console.log('📡 Loading VPN/Proxy detection databases...');
        
        const response = await axios.get('https://check.torproject.org/cgi-bin/TorBulkExitList.py?ip=1.1.1.1', {
            timeout: 10000
        });
        
        const exitNodes = response.data.split('\n').filter(ip => ip && !ip.startsWith('#'));
        exitNodes.forEach(ip => torExitNodes.add(ip.trim()));
        
        console.log(`✅ Loaded ${torExitNodes.size} Tor exit nodes`);
    } catch (error) {
        console.log('⚠️ Could not load Tor exit nodes, using fallback detection');
    }
}

// Load VPN databases
loadVPNDatabases();

// Enhanced IP detection for Vercel
function getRealIP(req) {
    // Vercel-specific headers
    const vercelHeaders = [
        'x-forwarded-for',
        'x-real-ip', 
        'cf-connecting-ip',
        'x-vercel-forwarded-for'
    ];

    // Check Vercel-specific headers first
    for (const header of vercelHeaders) {
        const value = req.headers[header];
        if (value) {
            const ip = value.split(',')[0].trim();
            if (isValidPublicIP(ip)) {
                return ip;
            }
        }
    }

    // Fallback to Express built-in
    if (req.ip && isValidPublicIP(req.ip)) {
        return req.ip.replace(/^::ffff:/, '');
    }

    return 'unknown';
}

function isValidPublicIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    
    const cleanIP = ip.replace(/^::ffff:/, '');
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    
    if (!ipv4Regex.test(cleanIP)) return false;
    
    const privateRanges = [
        /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./,
        /^169\.254\./, /^::1$/, /^fe80:/, /^fc00:/, /^fd00:/
    ];
    
    return !privateRanges.some(range => range.test(cleanIP));
}

async function detectVPNProxy(ip) {
    try {
        let isVPN = false;
        let vpnType = 'none';
        let confidence = 0;
        let detectionMethods = [];

        // Tor exit node check
        if (torExitNodes.has(ip)) {
            isVPN = true;
            vpnType = 'tor';
            confidence = 0.95;
            detectionMethods.push('tor_exit_node');
        }

        // GeoIP analysis
        const geo = geoip.lookup(ip);
        if (geo && geo.org) {
            const org = geo.org.toLowerCase();
            const vpnIndicators = [
                'amazon', 'google', 'microsoft', 'digitalocean', 'vultr',
                'linode', 'ovh', 'hetzner', 'vpn', 'proxy', 'hosting'
            ];
            
            const foundIndicator = vpnIndicators.find(indicator => org.includes(indicator));
            if (foundIndicator) {
                isVPN = true;
                vpnType = foundIndicator.includes('vpn') ? 'vpn' : 'hosting/proxy';
                confidence = Math.max(confidence, 0.7);
                detectionMethods.push('isp_analysis');
            }
        }

        return {
            isVPN,
            vpnType,
            confidence: Math.min(confidence, 1.0),
            detectionMethods,
            details: {
                torNode: torExitNodes.has(ip),
                organization: geo?.org || 'Unknown'
            }
        };
    } catch (error) {
        return {
            isVPN: false,
            vpnType: 'unknown',
            confidence: 0,
            detectionMethods: ['error']
        };
    }
}

function getLocationInfo(ip) {
    const geo = geoip.lookup(ip);
    if (!geo) {
        return {
            country: 'Unknown',
            region: 'Unknown', 
            city: 'Unknown',
            timezone: 'Unknown',
            coordinates: { lat: 0, lng: 0 },
            isp: 'Unknown'
        };
    }
    
    return {
        country: geo.country || 'Unknown',
        region: geo.region || 'Unknown',
        city: geo.city || 'Unknown', 
        timezone: geo.timezone || 'Unknown',
        coordinates: {
            lat: geo.ll ? geo.ll[0] : 0,
            lng: geo.ll ? geo.ll[1] : 0
        },
        isp: geo.org || 'Unknown'
    };
}

// API Routes
app.post('/api/track-visitor', async (req, res) => {
    try {
        const database = await connectToDatabase();
        
        const ipv4 = getRealIP(req);
        const userAgent = req.headers['user-agent'];
        const referer = req.headers.referer;
        const timestamp = new Date();
        
        const location = getLocationInfo(ipv4);
        const vpnInfo = await detectVPNProxy(ipv4);
        
        const visitorData = {
            ipv4,
            location,
            vpnInfo,
            browserInfo: {
                userAgent,
                language: req.headers['accept-language']?.split(',')[0] || 'Unknown',
                referer: referer || 'Direct'
            },
            timestamp,
            sessionId: req.body.sessionId || Date.now().toString(),
            environment: 'production'
        };
        
        await database.collection('visitors').insertOne(visitorData);
        
        res.json({ 
            success: true, 
            message: 'Visitor tracked successfully',
            detectedIP: ipv4,
            location: `${location.city}, ${location.country}`,
            vpnDetected: vpnInfo.isVPN
        });
    } catch (error) {
        console.error('Error tracking visitor:', error);
        res.status(500).json({ success: false, error: 'Failed to track visitor' });
    }
});

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AQGM@8433';
    
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, token: 'admin-authenticated' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

app.get('/api/admin/analytics', async (req, res) => {
    try {
        const database = await connectToDatabase();
        
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        const [totalVisitors, todayVisitors, countries, vpnUsers] = await Promise.all([
            database.collection('visitors').countDocuments(),
            database.collection('visitors').countDocuments({ timestamp: { $gte: today } }),
            database.collection('visitors').distinct('location.country'),
            database.collection('visitors').countDocuments({ 'vpnInfo.isVPN': true })
        ]);
        
        const uniqueCountries = countries.filter(c => c !== 'Unknown').length;
        
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

app.get('/api/admin/recent-visitors', async (req, res) => {
    try {
        const database = await connectToDatabase();
        const limit = parseInt(req.query.limit) || 50;
        
        const visitors = await database.collection('visitors')
            .find({})
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
        
        res.json(visitors);
    } catch (error) {
        console.error('Error fetching recent visitors:', error);
        res.status(500).json([]);
    }
});

app.get('/api/admin/location-stats', async (req, res) => {
    try {
        const database = await connectToDatabase();
        
        const locationStats = await database.collection('visitors').aggregate([
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
        res.status(500).json([]);
    }
});

app.get('/api/admin/timeline', async (req, res) => {
    try {
        const database = await connectToDatabase();
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
        
        const timelineData = await database.collection('visitors').aggregate([
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
        res.status(500).json([]);
    }
});

// For Vercel, export the Express app
module.exports = app;

// For local development, start the server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Raw Studio server running on port ${PORT}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
}
