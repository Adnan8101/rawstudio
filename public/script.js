// Performance optimized script
document.addEventListener('DOMContentLoaded', function() {
    // Hide loading screen
    setTimeout(() => {
        const loadingScreen = document.getElementById('loading-screen');
        loadingScreen.classList.add('fade-out');
        setTimeout(() => {
            loadingScreen.remove();
        }, 500);
    }, 2000);

    // Optimize modal animations
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.addEventListener('transitionend', function(e) {
            if (e.propertyName === 'opacity' && this.style.opacity === '0') {
                this.style.display = 'none';
            }
        });
    });

    // Throttled button hover effects
    const buttons = document.querySelectorAll('.discord-btn, .notify-btn');
    buttons.forEach(button => {
        let timeout;
        button.addEventListener('mouseenter', function() {
            clearTimeout(timeout);
            timeout = setTimeout(() => createParticleEffect(this), 100);
        });
    });
});

// Modal functionality - Optimized
function openDiscordModal() {
    const modal = document.getElementById('discordModal');
    modal.style.display = 'block';
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
    document.body.style.overflow = 'hidden';
}

function openNotifyModal() {
    const modal = document.getElementById('notifyModal');
    modal.style.display = 'block';
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
    document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('show');
    document.body.style.overflow = 'auto';
    
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
    
    // Reset notify form if closing notify modal
    if (modalId === 'notifyModal') {
        const form = document.querySelector('.notify-form');
        const submitBtn = document.querySelector('.submit-btn');
        form.reset();
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (event.target === modal) {
            closeModal(modal.id);
        }
    });
}

// Handle notify form submission
async function handleNotifySubmit(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = form.querySelector('.submit-btn');
    const email = document.getElementById('notifyEmail').value;
    const name = document.getElementById('notifyName').value;
    
    // Show loading state
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    
    try {
        await simulateAPICall(email, name);
        
        closeModal('notifyModal');
        setTimeout(() => {
            const successModal = document.getElementById('successModal');
            successModal.style.display = 'block';
            requestAnimationFrame(() => {
                successModal.classList.add('show');
            });
        }, 300);
        
        // Store email in localStorage (optional)
        localStorage.setItem('rawStudioNotifyEmail', email);
        if (name) localStorage.setItem('rawStudioNotifyName', name);
        
    } catch (error) {
        console.error('Error submitting notification request:', error);
        alert('Something went wrong. Please try again later.');
    } finally {
        // Reset loading state
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

// Simulate API call
function simulateAPICall(email, name) {
    return new Promise((resolve) => {
        setTimeout(() => {
            console.log('Notification signup:', { email, name, timestamp: new Date().toISOString() });
            resolve();
        }, 1500);
    });
}

// Keyboard navigation
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const openModal = document.querySelector('.modal.show');
        if (openModal) {
            closeModal(openModal.id);
        }
    }
});

// Optimized particle effect with reduced count
function createParticleEffect(button) {
    const rect = button.getBoundingClientRect();
    const particleCount = window.innerWidth < 768 ? 2 : 4; // Fewer particles on mobile
    
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.style.cssText = `
            position: fixed;
            width: 3px;
            height: 3px;
            background: linear-gradient(45deg, #8973d8, #ffc157);
            border-radius: 50%;
            pointer-events: none;
            z-index: 1000;
            left: ${rect.left + Math.random() * rect.width}px;
            top: ${rect.top + Math.random() * rect.height}px;
            animation: particleFloat 0.8s ease-out forwards;
        `;
        
        document.body.appendChild(particle);
        
        setTimeout(() => particle.remove(), 800);
    }
}

// Visitor tracking and admin functionality
let visitorSessionId = Date.now().toString();
let adminAuthenticated = false;

// Track visitor on page load
document.addEventListener('DOMContentLoaded', function() {
    // Track visitor
    trackVisitor();
    
    // Hide loading screen
    setTimeout(() => {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.classList.add('fade-out');
            setTimeout(() => {
                loadingScreen.remove();
            }, 500);
        }
    }, 2000);

    // Initialize admin dashboard if authenticated
    if (localStorage.getItem('adminToken')) {
        adminAuthenticated = true;
        showAdminDashboard();
    }
});

// Track visitor function
async function trackVisitor() {
    try {
        const response = await fetch('/api/track-visitor', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId: visitorSessionId,
                timestamp: new Date().toISOString()
            })
        });
        
        if (response.ok) {
            console.log('Visitor tracked successfully');
        }
    } catch (error) {
        console.error('Error tracking visitor:', error);
    }
}

// Admin Modal Functions
function openAdminModal() {
    const modal = document.getElementById('adminModal');
    modal.style.display = 'block';
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
    document.body.style.overflow = 'hidden';
}

// Handle admin login
async function handleAdminLogin(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = form.querySelector('.admin-btn');
    const password = document.getElementById('adminPassword').value;
    const errorDiv = document.getElementById('adminError');
    
    // Clear previous errors
    errorDiv.textContent = '';
    
    // Show loading state
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            localStorage.setItem('adminToken', data.token);
            adminAuthenticated = true;
            closeModal('adminModal');
            showAdminDashboard();
        } else {
            errorDiv.textContent = 'Invalid password. Please try again.';
        }
    } catch (error) {
        console.error('Admin login error:', error);
        errorDiv.textContent = 'Login failed. Please try again.';
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

// Show admin dashboard
function showAdminDashboard() {
    document.getElementById('main-content').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'block';
    loadAnalytics();
    
    // Auto-refresh every 30 seconds
    setInterval(loadAnalytics, 30000);
}

// Load analytics data
async function loadAnalytics() {
    try {
        // Load main stats
        const analyticsResponse = await fetch('/api/admin/analytics');
        const analytics = await analyticsResponse.json();
        
        document.getElementById('totalVisitors').textContent = analytics.totalVisitors;
        document.getElementById('todayVisitors').textContent = analytics.todayVisitors;
        document.getElementById('uniqueCountries').textContent = analytics.uniqueCountries;
        document.getElementById('vpnUsers').textContent = analytics.vpnUsers;
        
        // Load recent visitors
        loadRecentVisitors();
        
        // Load location stats
        loadLocationStats();
        
        // Load timeline data
        loadTimelineData();
        
    } catch (error) {
        console.error('Error loading analytics:', error);
    }
}

// Load recent visitors
async function loadRecentVisitors() {
    try {
        const response = await fetch('/api/admin/recent-visitors?limit=10');
        const visitors = await response.json();
        
        const visitorsList = document.getElementById('visitorsList');
        visitorsList.innerHTML = '';
        
        visitors.forEach(visitor => {
            const visitorElement = document.createElement('div');
            visitorElement.className = 'visitor-item';
            
            const timeAgo = getTimeAgo(new Date(visitor.timestamp));
            const vpnBadge = visitor.vpnInfo.isVPN ? 
                `<span class="vpn-badge">VPN</span>` : '';
            
            visitorElement.innerHTML = `
                <div class="visitor-info">
                    <div class="visitor-location">
                        <span class="country-flag">${getCountryFlag(visitor.location.country)}</span>
                        <span class="location-text">${visitor.location.city}, ${visitor.location.country}</span>
                        ${vpnBadge}
                    </div>
                    <div class="visitor-ip">${visitor.ipv4}</div>
                    <div class="visitor-time">${timeAgo}</div>
                </div>
            `;
            
            visitorsList.appendChild(visitorElement);
        });
    } catch (error) {
        console.error('Error loading recent visitors:', error);
    }
}

// Load location statistics
async function loadLocationStats() {
    try {
        const response = await fetch('/api/admin/location-stats');
        const locationStats = await response.json();
        
        const locationContainer = document.getElementById('locationStats');
        locationContainer.innerHTML = '';
        
        locationStats.forEach(stat => {
            if (stat._id !== 'Unknown') {
                const locationElement = document.createElement('div');
                locationElement.className = 'location-item';
                
                locationElement.innerHTML = `
                    <div class="location-info">
                        <span class="country-flag">${getCountryFlag(stat._id)}</span>
                        <span class="country-name">${stat._id}</span>
                    </div>
                    <span class="visitor-count">${stat.count}</span>
                `;
                
                locationContainer.appendChild(locationElement);
            }
        });
    } catch (error) {
        console.error('Error loading location stats:', error);
    }
}

// Load timeline data
async function loadTimelineData() {
    try {
        const activeFilter = document.querySelector('.filter-btn.active').dataset.filter;
        const response = await fetch(`/api/admin/timeline?filter=${activeFilter}`);
        const timelineData = await response.json();
        
        const timelineChart = document.getElementById('timelineChart');
        timelineChart.innerHTML = '';
        
        if (timelineData.length === 0) {
            timelineChart.innerHTML = '<p class="no-data">No data available</p>';
            return;
        }
        
        // Simple bar chart visualization
        const maxCount = Math.max(...timelineData.map(d => d.count));
        
        timelineData.forEach(dataPoint => {
            const barElement = document.createElement('div');
            barElement.className = 'timeline-bar';
            
            const height = (dataPoint.count / maxCount) * 100;
            const label = activeFilter === '24h' ? 
                `${dataPoint._id.hour}:00` : 
                `${dataPoint._id.day}/${dataPoint._id.month}`;
            
            barElement.innerHTML = `
                <div class="bar" style="height: ${height}%"></div>
                <div class="bar-label">${label}</div>
                <div class="bar-value">${dataPoint.count}</div>
            `;
            
            timelineChart.appendChild(barElement);
        });
    } catch (error) {
        console.error('Error loading timeline data:', error);
    }
}

// Helper functions
function getTimeAgo(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
}

function getCountryFlag(countryCode) {
    const flagMap = {
        'IN': '🇮🇳', 'US': '🇺🇸', 'GB': '🇬🇧', 'DE': '🇩🇪', 'FR': '🇫🇷',
        'CA': '🇨🇦', 'AU': '🇦🇺', 'JP': '🇯🇵', 'CN': '🇨🇳', 'BR': '🇧🇷'
    };
    return flagMap[countryCode] || '🌍';
}

// Admin control functions
function refreshAnalytics() {
    loadAnalytics();
    
    // Show refresh animation
    const refreshBtn = document.querySelector('.refresh-btn');
    refreshBtn.classList.add('refreshing');
    setTimeout(() => {
        refreshBtn.classList.remove('refreshing');
    }, 1000);
}

function logoutAdmin() {
    localStorage.removeItem('adminToken');
    adminAuthenticated = false;
    document.getElementById('admin-dashboard').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
}

// Timeline filter functionality
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('filter-btn')) {
        document.querySelectorAll('.filter-btn').forEach(btn => 
            btn.classList.remove('active'));
        e.target.classList.add('active');
        loadTimelineData();
    }
});

// Existing modal and website functionality
function openDiscordModal() {
    const modal = document.getElementById('discordModal');
    modal.style.display = 'block';
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
    document.body.style.overflow = 'hidden';
}

function openNotifyModal() {
    const modal = document.getElementById('notifyModal');
    modal.style.display = 'block';
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
    document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('show');
    document.body.style.overflow = 'auto';
    
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
    
    // Reset forms
    if (modalId === 'notifyModal') {
        const form = document.querySelector('.notify-form');
        const submitBtn = document.querySelector('.submit-btn');
        form.reset();
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
    
    if (modalId === 'adminModal') {
        const form = document.querySelector('.admin-form');
        const submitBtn = document.querySelector('.admin-btn');
        const errorDiv = document.getElementById('adminError');
        form.reset();
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
        errorDiv.textContent = '';
    }
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (event.target === modal) {
            closeModal(modal.id);
        }
    });
}

// Handle notify form submission
async function handleNotifySubmit(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = form.querySelector('.submit-btn');
    const email = document.getElementById('notifyEmail').value;
    const name = document.getElementById('notifyName').value;
    
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    
    try {
        await simulateAPICall(email, name);
        
        closeModal('notifyModal');
        setTimeout(() => {
            const successModal = document.getElementById('successModal');
            successModal.style.display = 'block';
            requestAnimationFrame(() => {
                successModal.classList.add('show');
            });
        }, 300);
        
        localStorage.setItem('rawStudioNotifyEmail', email);
        if (name) localStorage.setItem('rawStudioNotifyName', name);
        
    } catch (error) {
        console.error('Error submitting notification request:', error);
        alert('Something went wrong. Please try again later.');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

function simulateAPICall(email, name) {
    return new Promise((resolve) => {
        setTimeout(() => {
            console.log('Notification signup:', { email, name, timestamp: new Date().toISOString() });
            resolve();
        }, 1500);
    });
}

// Keyboard navigation
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const openModal = document.querySelector('.modal.show');
        if (openModal) {
            closeModal(openModal.id);
        }
    }
});


// Add particle animation CSS dynamically
const particleStyle = document.createElement('style');
particleStyle.textContent = `
    @keyframes particleFloat {
        0% {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
        100% {
            opacity: 0;
            transform: translateY(-30px) scale(0);
        }
    }
`;
document.head.appendChild(particleStyle);
