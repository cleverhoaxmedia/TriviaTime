// ===== app.js — the phone front end =====
//
// Dumb terminal by design. The display owns the game; this app only mirrors
// games/{GAME_ID} and writes one vote doc per question. It never learns the answer
// text, and never learns correctIndex until the display publishes it at the reveal.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, GAME_ID } from "./firebase-config.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

const gameRef = doc(db, "games", GAME_ID);

const $ = id => document.getElementById(id);
const views  = { join: $("join"), play: $("play"), end: $("end") };
const nameEl = $("name"), joinBtn = $("joinBtn"), joinHint = $("joinHint");
const whoEl  = $("who"), qNumEl = $("qNum"), scoreEl = $("score");
const statusEl = $("status"), boardEl = $("board"), myPlaceEl = $("myPlace");
const answersEl = $("answers"), eyesupEl = $("eyesup"), eyesTitleEl = $("eyesTitle"), eyesSubEl = $("eyesSub");
const toastEl = $("toast");
const buttons = [...answersEl.querySelectorAll(".ans")];

let uid = null;
let name = localStorage.getItem("trivia.name") || "";
let game = null;
let myChoice = null;     // my vote for the round now on screen
let lastQ = null;        // question we last reset the board for
let sawOpen = false;     // did voting actually open on this question? (tells "locked in" from "get ready")
let sending = false;

// ===== chrome =====
function show(view) {
  Object.entries(views).forEach(([k, el]) => el.classList.toggle("on", k === view));
}
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}
function setStatus(text, tone) {
  statusEl.textContent = text;
  statusEl.className = "status" + (tone ? " " + tone : "");
}

// Phones lock themselves after ~30s and players miss the next question.
async function keepAwake() {
  try { await navigator.wakeLock?.request("screen"); } catch { /* unsupported or denied */ }
}

// ===== join =====
nameEl.value = name;
nameEl.addEventListener("input", () => {
  joinBtn.disabled = !uid || !nameEl.value.trim();
});

joinBtn.addEventListener("click", async () => {
  const chosen = nameEl.value.trim().slice(0, 20);
  if (!chosen || !uid) return;
  joinBtn.disabled = true;
  joinBtn.textContent = "Joining…";
  try {
    // Rules let a player create their doc with score 0, or rename later — but never
    // touch their own score. So an existing player renames instead of re-creating.
    const ref  = doc(db, "games", GAME_ID, "players", uid);
    const snap = await getDoc(ref);
    if (snap.exists()) await updateDoc(ref, { name: chosen });
    else await setDoc(ref, { name: chosen, score: 0, joinedAt: serverTimestamp() });

    name = chosen;
    localStorage.setItem("trivia.name", name);
    whoEl.textContent = name;
    onSnapshot(ref, s => { scoreEl.textContent = s.data()?.score ?? 0; });
    show("play");
    // make the name land with a little bounce — kids love seeing it appear
    whoEl.classList.remove("pop"); void whoEl.offsetWidth; whoEl.classList.add("pop");
    render();
    keepAwake();
  } catch (err) {
    console.error(err);
    joinBtn.disabled = false;
    joinBtn.textContent = "Join";
    toast("Couldn't join — check your connection.");
  }
});

// ===== voting =====
buttons.forEach(btn => btn.addEventListener("click", () => vote(Number(btn.dataset.choice))));

async function vote(choice) {
  if (sending || !game?.accepting || game.correctIndex !== null) return;
  const previous = myChoice;
  myChoice = choice;
  sending = true;
  paintChoice();                     // optimistic: the tap must feel instant
  render();                          // …and confirm "Locked in" without waiting on the network
  try {
    await setDoc(
      doc(db, "games", GAME_ID, "rounds", String(game.qIndex), "votes", uid),
      { choice, name, at: serverTimestamp() }
    );
  } catch (err) {
    myChoice = previous;             // rules rejected it — almost always a closed window
    paintChoice();
    render();
    toast(game?.accepting ? "Vote didn't send. Try again." : "Too late — answers are closed!");
  } finally {
    sending = false;
  }
}

function paintChoice() {
  buttons.forEach((b, i) => b.classList.toggle("picked", i === myChoice));
}

function resetRound() {
  myChoice = null;
  sawOpen = false;
  answersEl.classList.remove("locked", "show");
  buttons.forEach(b => {
    b.classList.remove("picked", "right", "wrong");
    b.querySelector(".verdict").textContent = "";
  });
}

// Show the "eyes up" gate; hide the answer stack and status line.
function showEyesUp(title, sub) {
  eyesTitleEl.textContent = title || "Eyes Up!";
  eyesSubEl.textContent   = sub != null ? sub : "Look at the screen";
  eyesupEl.classList.remove("gone");
  answersEl.classList.add("gone");
  answersEl.classList.remove("show");
  statusEl.classList.add("gone");
}

// Reveal the answer stack; `.show` fires the staggered pop-in (idempotent until resetRound).
function enterAnswers() {
  eyesupEl.classList.add("gone");
  answersEl.classList.remove("gone");
  answersEl.classList.add("show");
  statusEl.classList.remove("gone");
}

// ===== render =====
function render() {
  if (!game) return;

  if (game.phase === "end") { renderEnd(); return; }
  if (views.join.classList.contains("on")) return;   // still on the name screen

  if (game.phase !== "playing") {
    qNumEl.textContent = "Get ready…";
    showEyesUp("Get Ready!", "The game's about to start");
    return;
  }

  if (game.qIndex !== lastQ) { lastQ = game.qIndex; resetRound(); }
  if (game.accepting) sawOpen = true;

  qNumEl.textContent = game.qTotal
    ? `Question ${game.qIndex + 1} of ${game.qTotal}`
    : `Question ${game.qIndex + 1}`;

  // The four answer cards only appear once the display has opened voting for this
  // question. Until then it's the "eyes up" gate. Once they've appeared they stay put
  // through the drumroll and the reveal.
  if (!sawOpen) { showEyesUp(); return; }

  enterAnswers();

  const revealed = game.correctIndex !== null && game.correctIndex !== undefined;
  const open = game.accepting && !revealed;
  const opts = game.options || [];

  buttons.forEach((b, i) => {
    b.querySelector(".atext").textContent = opts[i] || "";
    b.disabled = !open;
  });
  answersEl.classList.toggle("locked", !open);

  if (revealed) {
    const right = buttons[game.correctIndex];
    right.classList.add("right");
    right.querySelector(".verdict").textContent = "✓";
    if (myChoice === null)                   setStatus("You sat this one out.", "wait");
    else if (myChoice === game.correctIndex) setStatus("Correct! +1 🎉", "good");
    else {
      buttons[myChoice].classList.add("wrong");
      buttons[myChoice].querySelector(".verdict").textContent = "✗";
      setStatus("So close! Look up 👀", "bad");
    }
  } else if (open) {
    setStatus(myChoice === null ? "Tap your answer!" : "Locked in — tap another to change");
  } else {
    setStatus(myChoice === null ? "Answers closed 🥁" : "Locked in! Drumroll… 🥁", "wait");
  }
}

function renderEnd() {
  show("end");
  const rows = game.leaderboard || [];
  boardEl.innerHTML = "";
  rows.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "row" + (r.name === name ? " me" : "");
    const rank = document.createElement("span"); rank.className = "rank"; rank.textContent = i + 1;
    const nm   = document.createElement("span"); nm.className   = "nm";   nm.textContent   = r.name;
    const pts  = document.createElement("span"); pts.className  = "pts";  pts.textContent  = r.score;
    row.append(rank, nm, pts);
    boardEl.appendChild(row);
  });
  const mine = rows.findIndex(r => r.name === name);
  myPlaceEl.textContent = !rows.length ? "No scores recorded."
    : mine >= 0 ? `You finished #${mine + 1}. Thanks for playing! 🐾`
    : "Thanks for playing! 🐾";
}

// ===== boot =====
// The listener must wait for sign-in: rules require an authenticated read, and a
// permission-denied kills an onSnapshot for good rather than retrying it.
let watching = false;
function watchGame() {
  if (watching) return;
  watching = true;
  onSnapshot(gameRef, snap => {
    game = snap.data() || null;
    render();
  }, err => {
    console.error(err);
    toast("Lost connection to the game.");
  });
}

onAuthStateChanged(auth, user => {
  if (!user) return;
  uid = user.uid;
  joinBtn.textContent = "Join";
  joinBtn.disabled = !nameEl.value.trim();
  joinHint.textContent = "Pick a name the room will recognise.";
  watchGame();
});

signInAnonymously(auth).catch(err => {
  console.error(err);
  joinBtn.textContent = "Offline";
  joinHint.textContent = "Can't reach the game. Check the wifi and reload.";
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") keepAwake();
});
