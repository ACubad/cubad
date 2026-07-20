import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "https://cubad.vercel.app";
const SESSION_COOKIE = __ENV.SESSION_COOKIE;

export const options = {
  scenarios: {
    authed_study_loop: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "60s", target: 50 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    // Entitlement checks add latency on top of the shared content cache.
    http_req_duration: ["p(95)<800"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  if (!SESSION_COOKIE) {
    throw new Error("Set -e SESSION_COOKIE=... (see README-session.txt)");
  }
  const headers = { Cookie: SESSION_COOKIE };

  const account = http.get(`${BASE_URL}/account`, { headers });
  check(account, { "account 200": (response) => response.status === 200 });
  sleep(1);

  const unit = http.get(`${BASE_URL}/s/hidroloji/unit/giris`, { headers });
  check(unit, { "unit 200": (response) => response.status === 200 });
  sleep(2);
}
