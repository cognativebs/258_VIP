import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import worker from "./worker.js";

const TOKEN = `vip-ebay-deletion-token-${"x".repeat(8)}`;
const HOST = "https://vip-ebay-deletion.example.workers.dev";

function expectedHex(challenge, token, endpoint) {
  return createHash("sha256").update(`${challenge}${token}${endpoint}`, "utf8").digest("hex");
}

describe("ebay deletion worker", () => {
  it("derives the portal URL without a trailing slash when ENDPOINT_URL is unset", async () => {
    const challenge = "from-ebay";
    const res = await worker.fetch(new Request(`${HOST}/?challenge_code=${challenge}`), {
      VERIFICATION_TOKEN: TOKEN,
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ["challengeResponse"]);
    assert.equal(body.challengeResponse, expectedHex(challenge, TOKEN, HOST));
  });

  it("hashes the exact ENDPOINT_URL when set, even if the request has a slash", async () => {
    const challenge = "explicit";
    const portal = `${HOST}/custom`;
    const res = await worker.fetch(
      new Request(`${HOST}/custom/?challenge_code=${challenge}`),
      { VERIFICATION_TOKEN: TOKEN, ENDPOINT_URL: portal },
    );
    const body = await res.json();
    assert.equal(body.challengeResponse, expectedHex(challenge, TOKEN, portal));
  });

  it("health is configured once the token is set on a public https host", async () => {
    const res = await worker.fetch(new Request(`${HOST}/`), {
      VERIFICATION_TOKEN: TOKEN,
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.configured, true);
    assert.equal(body.endpointUrl, HOST);
  });

  it("acks POST without inventing user deletes", async () => {
    const res = await worker.fetch(
      new Request(HOST, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notification: { notificationId: "n-w" } }),
      }),
      { VERIFICATION_TOKEN: TOKEN },
    );
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.acknowledged, true);
    assert.equal(body.deletedRecords, 0);
    assert.equal(body.notificationId, "n-w");
  });

  it("rejects a challenge when the token is missing", async () => {
    const res = await worker.fetch(new Request(`${HOST}/?challenge_code=x`), {});
    assert.equal(res.status, 503);
  });
});
