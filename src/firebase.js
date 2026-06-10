
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCWeQ9rWcZGj_29LY14Ztb7fKXU0_6b6X8",
  authDomain: "arenapp-63a04.firebaseapp.com",
  projectId: "arenapp-63a04",
  storageBucket: "arenapp-63a04.firebasestorage.app",
  messagingSenderId: "1040391625845",
  appId: "1:1040391625845:web:4ea7857860180424ad6c3c"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Firestore con caché local: la app sigue funcionando sin internet y sincroniza al volver.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
});
