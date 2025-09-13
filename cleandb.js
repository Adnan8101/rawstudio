const { MongoClient } = require('mongodb');
require('dotenv').config();

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/rawstudio';

async function cleanDatabase() {
    let client;
    
    try {
        console.log('🗑️ ================================');
        console.log('🚀 Starting Raw Studio Database Cleanup');
        console.log('================================');
        
        // Connect to MongoDB
        console.log('📡 Connecting to MongoDB...');
        client = new MongoClient(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        
        await client.connect();
        console.log('✅ Connected to MongoDB successfully');
        
        const db = client.db('rawstudio');
        
        // Get all collections in the database
        console.log('📋 Fetching all collections...');
        const collections = await db.listCollections().toArray();
        
        if (collections.length === 0) {
            console.log('ℹ️ No collections found in database');
            return;
        }
        
        console.log(`📊 Found ${collections.length} collection(s):`);
        collections.forEach(col => {
            console.log(`   📁 ${col.name}`);
        });
        
        console.log('\n🗑️ Starting cleanup process...');
        
        let totalDropped = 0;
        let totalDocumentsRemoved = 0;
        
        // Drop each collection
        for (const collectionInfo of collections) {
            const collectionName = collectionInfo.name;
            
            try {
                // Count documents before dropping
                const docCount = await db.collection(collectionName).countDocuments();
                console.log(`🔍 Collection "${collectionName}": ${docCount} documents`);
                
                // Drop the collection
                const result = await db.collection(collectionName).drop();
                
                if (result) {
                    console.log(`✅ Dropped collection "${collectionName}" (${docCount} documents removed)`);
                    totalDropped++;
                    totalDocumentsRemoved += docCount;
                } else {
                    console.log(`❌ Failed to drop collection "${collectionName}"`);
                }
                
            } catch (error) {
                if (error.message.includes('ns not found')) {
                    console.log(`⚠️ Collection "${collectionName}" does not exist (already cleaned)`);
                } else {
                    console.error(`❌ Error dropping collection "${collectionName}":`, error.message);
                }
            }
        }
        
        // Summary
        console.log('\n📊 ================================');
        console.log('🎉 CLEANUP SUMMARY');
        console.log('================================');
        console.log(`✅ Collections dropped: ${totalDropped}`);
        console.log(`🗑️ Total documents removed: ${totalDocumentsRemoved}`);
        console.log(`🌟 Database cleaned successfully!`);
        
        // Verify cleanup
        console.log('\n🔍 Verifying cleanup...');
        const remainingCollections = await db.listCollections().toArray();
        
        if (remainingCollections.length === 0) {
            console.log('✅ Verification passed: All collections removed');
        } else {
            console.log(`⚠️ Warning: ${remainingCollections.length} collection(s) still exist:`);
            remainingCollections.forEach(col => {
                console.log(`   📁 ${col.name}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Database cleanup failed:', error.message);
        
        if (error.message.includes('authentication failed')) {
            console.log('\n💡 TROUBLESHOOTING:');
            console.log('   • Check your MongoDB URI in .env file');
            console.log('   • Verify your database credentials');
            console.log('   • Ensure your IP is whitelisted in MongoDB Atlas');
        } else if (error.message.includes('ENOTFOUND')) {
            console.log('\n💡 TROUBLESHOOTING:');
            console.log('   • Check your internet connection');
            console.log('   • Verify the MongoDB cluster hostname');
            console.log('   • Check if MongoDB Atlas is accessible');
        }
        
        process.exit(1);
        
    } finally {
        // Close connection
        if (client) {
            await client.close();
            console.log('🔌 MongoDB connection closed');
        }
        
        console.log('================================');
        console.log('🏁 Cleanup process completed');
        console.log('================================\n');
    }
}

// Add command line interface
if (process.argv.includes('--confirm')) {
    cleanDatabase();
} else {
    console.log('🚨 ================================');
    console.log('⚠️  WARNING: DATABASE CLEANUP');
    console.log('================================');
    console.log('This will permanently delete ALL data in your Raw Studio database!');
    console.log('\n📋 What will be deleted:');
    console.log('   • All visitor tracking data');
    console.log('   • All analytics history');
    console.log('   • All collections and documents');
    console.log('\n⚠️  THIS ACTION CANNOT BE UNDONE!');
    console.log('\n🔧 To proceed, run:');
    console.log('   node cleandb.js --confirm');
    console.log('\n❌ Operation cancelled for safety');
}
