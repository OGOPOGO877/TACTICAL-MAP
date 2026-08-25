import { apiUrl, isDiscordEmbed, localRoomId, localUserId, localUsername } from "./config.js";

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function queryParam(name) {
  return new URLSearchParams(location.search).get(name);
}

async function loadSdk() {
  try {
    return await import("./vendor/discord-sdk.js");
  } catch (err) {
    console.warn("Discord SDK bundle not available", err);
    return null;
  }
}

async function authorize(sdk, clientId) {
  const scopesList = [
    ["identify", "rpc.activities.write", "applications.commands"],
    ["identify", "applications.commands"],
    ["identify"],
  ];
  let lastErr;
  for (const scope of scopesList) {
    try {
      return await sdk.commands.authorize({
        client_id: clientId,
        response_type: "code",
        state: "",
        prompt: "none",
        scope,
      });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("authorize failed");
}

export async function initDiscord(clientId) {
  const fallbackUser = {
    id: localUserId(),
    username: localUsername(),
    avatar: "",
  };

  const embed = isDiscordEmbed();
  if (!embed || !clientId) {
    return {
      mode: "local",
      user: fallbackUser,
      roomId: localRoomId(),
      sdk: null,
    };
  }

  const sdkMod = await loadSdk();
  if (!sdkMod?.DiscordSDK) {
    return {
      mode: "local",
      user: fallbackUser,
      roomId: queryParam("instance_id") || localRoomId(),
      sdk: null,
    };
  }

  let sdk;
  try {
    sdk = new sdkMod.DiscordSDK(clientId);
  } catch (err) {
    console.warn("DiscordSDK construct failed", err);
    return { mode: "local", user: fallbackUser, roomId: localRoomId(), sdk: null };
  }

  const instanceId = sdk.instanceId || queryParam("instance_id");
  let user = fallbackUser;

  try {
    await withTimeout(sdk.ready(), 8000, "discord.ready");
  } catch (err) {
    console.warn(err);
    return {
      mode: "discord-limited",
      user,
      roomId: instanceId || localRoomId(),
      sdk,
    };
  }

  try {
    const { code } = await withTimeout(authorize(sdk, clientId), 20000, "discord.authorize");
    const tokenRes = await fetch(apiUrl("/api/token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.error || "token exchange failed");
    }
    const auth = await sdk.commands.authenticate({ access_token: tokenJson.access_token });
    if (auth?.user) {
      user = {
        id: auth.user.id,
        username: auth.user.global_name || auth.user.username || fallbackUser.username,
        avatar: auth.user.avatar || "",
      };
    }
  } catch (err) {
    console.warn("Discord auth failed, continuing with instance room", err);
  }

  try {
    await sdk.commands.setActivity({
      activity: {
        type: 0,
        details: "Escape from Tarkov",
        state: "Planning raid",
      },
    });
  } catch {
    /* optional */
  }

  return {
    mode: "discord",
    user,
    roomId: instanceId,
    sdk,
  };
}

export async function updatePresence(session, mapName, userCount) {
  if (!session?.sdk?.commands?.setActivity) return;
  try {
    await session.sdk.commands.setActivity({
      activity: {
        type: 0,
        details: "Escape from Tarkov",
        state: mapName ? `Map: ${mapName}` : "Tactical Map",
        party: {
          id: session.roomId || "tactical-map",
          size: [Math.max(1, userCount || 1), 16],
        },
      },
    });
  } catch {
    /* optional */
  }
}
