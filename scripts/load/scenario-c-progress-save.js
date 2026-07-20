import http from "k6/http";
import { sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "https://cubad.vercel.app";
const SESSION_COOKIE = __ENV.SESSION_COOKIE;

export const options = { vus: 1, iterations: 15 };

export default function () {
  if (!SESSION_COOKIE) {
    throw new Error("Set -e SESSION_COOKIE=... (see README-session.txt)");
  }
  const headers = { "Content-Type": "application/json", Cookie: SESSION_COOKIE };

  // Use only a disposable test account. GET supplies the compare-and-swap token required by the
  // real state contract, so this probe never overwrites a real student's progress.
  const pulled = http.get(`${BASE_URL}/api/state`, { headers });
  if (pulled.status !== 200) {
    console.log(`pull -> ${pulled.status}`);
    return;
  }

  const remote = pulled.json();
  const response = http.post(
    `${BASE_URL}/api/state`,
    JSON.stringify({
      state: remote.state ?? {
        progress: { q: {}, quiz: {}, practice: {} },
        decks: {},
        chats: {},
      },
      base_updated_at: remote.updated_at,
    }),
    { headers }
  );
  console.log(`iteration -> ${response.status}`);
  sleep(1);
}
