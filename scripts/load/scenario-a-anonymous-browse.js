import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "https://cubad.vercel.app";

export const options = {
  scenarios: {
    anonymous_browse: {
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
    "http_req_duration{route:home}": ["p(95)<500"],
    "http_req_duration{route:subject}": ["p(95)<500"],
    "http_req_duration{route:free_unit}": ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const home = http.get(`${BASE_URL}/`, { tags: { route: "home" } });
  check(home, { "home 200": (response) => response.status === 200 });
  sleep(1);

  const subject = http.get(`${BASE_URL}/s/hidroloji`, { tags: { route: "subject" } });
  check(subject, { "subject 200": (response) => response.status === 200 });
  sleep(1);

  // Anonymous visitors receive the public preview-choice or paywall shell for this real unit.
  const unit = http.get(`${BASE_URL}/s/hidroloji/unit/giris`, {
    tags: { route: "free_unit" },
  });
  check(unit, { "free unit 200": (response) => response.status === 200 });
  sleep(2);
}
