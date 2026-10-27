/* Firebase 初期化（全画面共通） */
var firebaseConfig = {
  apiKey: "AIzaSyAZCVAqpOXMjoKTz99netnxcsr2Yts8Rso",
  authDomain: "attendance-app-3092a.firebaseapp.com",
  projectId: "attendance-app-3092a",
  storageBucket: "attendance-app-3092a.firebasestorage.app",
  messagingSenderId: "1049451840444",
  appId: "1:1049451840444:web:04d60e7e1f486cbffaa633"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

var db = firebase.firestore();
