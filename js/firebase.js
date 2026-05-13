
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCWt7DoOWERm5MzBgoF1q1WXmOkmRq3k3s",
  authDomain: "cps-web-eb135.firebaseapp.com",
  projectId: "cps-web-eb135",
  storageBucket: "cps-web-eb135.firebasestorage.app",
  messagingSenderId: "1097580366929",
  appId: "1:1097580366929:web:4b4d230ea74290c5013c70"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
export { auth, db };