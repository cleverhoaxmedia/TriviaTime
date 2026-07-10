// Firebase project settings for the PLAYER app (the phone front end).
// Same values as Display/firebase-config.js — but NOT the host email; phones sign in anonymously.
// The apiKey is a public project identifier, not a secret — security lives in firestore.rules.
export const firebaseConfig = {
  apiKey:            "AIzaSyAWanxZNomdfZlpW0QH0o9U4zBrubIZxsU",
  authDomain:        "triviatime-58ff3.firebaseapp.com",
  projectId:         "triviatime-58ff3",
  storageBucket:     "triviatime-58ff3.firebasestorage.app",
  messagingSenderId: "434071730911",
  appId:             "1:434071730911:web:8ff92aac33d5eaa299476a",
};

// Must match GAME_ID in Display/firebase-config.js.
export const GAME_ID = "lpsminicon";
