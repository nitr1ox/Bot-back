const admin = require('firebase-admin');

// On Render : set FIREBASE_SERVICE_ACCOUNT env var with the JSON content (as string)
// Locally   : set it too, or put serviceAccountKey.json next to this file

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (e) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT invalide (JSON mal formé)');
    process.exit(1);
  }
} else {
  // Fallback : fichier local (ne pas committer en prod !)
  try {
    serviceAccount = require('./serviceAccountKey.json');
  } catch {
    console.error('❌ Pas de credentials Firebase. Configure FIREBASE_SERVICE_ACCOUNT ou serviceAccountKey.json');
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

module.exports = { db, admin };
