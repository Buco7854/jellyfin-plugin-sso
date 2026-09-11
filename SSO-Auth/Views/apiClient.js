const CREDENTIALS_KEY = "jellyfin_credentials";
const DEVICE_ID_KEY = "_deviceId2";
const APP_NAME = "SSO-Auth";
const APP_VERSION = "5.0.0.2";
const DEVICE_NAME = "Browser";

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const normalizeAddress = (address) => address?.replace(/\/+$/, "");

// Based on jellyfin-web's server address discovery. The standalone linking page
// cannot use jellyfin-web's in-memory ApiClient after a full-page navigation.
export async function serverAddress({ basePath = "/web" } = {}) {
  const existingApiClient = window.ApiClient;

  if (existingApiClient) {
    return existingApiClient.serverAddress();
  }

  const getViewUrl = (path) => {
    const index = window.location.href
      .toLowerCase()
      .lastIndexOf(path.toLowerCase());
    return index === -1 ? undefined : window.location.href.substring(0, index);
  };

  const candidate =
    getViewUrl(basePath) ?? getViewUrl("/web") ?? window.location.origin;

  if (candidate.startsWith("file:")) {
    throw new Error("Unable to determine the Jellyfin server address.");
  }

  const response = await fetch(
    `${normalizeAddress(candidate)}/System/Info/Public`,
  );
  if (!response.ok) {
    throw new Error("Unable to connect to the Jellyfin server.");
  }

  return normalizeAddress(candidate);
}

async function readAuthenticatedServer(address, timeoutMilliseconds = 10000) {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    const storedCredentials = localStorage.getItem(CREDENTIALS_KEY);

    if (storedCredentials) {
      try {
        const credentials = JSON.parse(storedCredentials);
        const authenticatedServers = (credentials.Servers || []).filter(
          (server) => server.AccessToken && server.UserId,
        );
        const normalizedAddress = normalizeAddress(address);
        const matchingServer = authenticatedServers.find((server) =>
          [server.LocalAddress, server.ManualAddress, server.RemoteAddress]
            .map(normalizeAddress)
            .includes(normalizedAddress),
        );

        if (matchingServer) {
          return matchingServer;
        }
      } catch (error) {
        console.warn("Unable to read stored Jellyfin credentials", error);
      }
    }

    await sleep(100);
  }

  throw new Error("No authenticated Jellyfin session is available.");
}

function createAuthorizationHeader(accessToken, deviceId) {
  const values = [
    `Client="${encodeURIComponent(APP_NAME)}"`,
    `Device="${encodeURIComponent(DEVICE_NAME)}"`,
    `Version="${encodeURIComponent(APP_VERSION)}"`,
    `Token="${encodeURIComponent(accessToken)}"`,
  ];

  if (deviceId) {
    values.splice(2, 0, `DeviceId="${encodeURIComponent(deviceId)}"`);
  }

  return `MediaBrowser ${values.join(", ")}`;
}

function createApiClient(address, authenticatedServer) {
  const authorizationHeader = createAuthorizationHeader(
    authenticatedServer.AccessToken,
    localStorage.getItem(DEVICE_ID_KEY),
  );

  return {
    serverAddress: () => address,
    getCurrentUserId: () => authenticatedServer.UserId,
    getUrl: (path) =>
      `${normalizeAddress(address)}/${String(path).replace(/^\/+/, "")}`,
    fetch: async (request) => {
      const headers = new Headers(request.headers || {});
      headers.set("Authorization", authorizationHeader);

      if (request.contentType) {
        headers.set("Content-Type", request.contentType);
      }

      const response = await fetch(request.url, {
        method: request.type || "GET",
        headers,
        body: request.data,
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw response;
      }

      if (request.dataType === "json") {
        return response.json();
      }

      if (request.dataType === "text") {
        return response.text();
      }

      return response;
    },
  };
}

const address = await serverAddress({ basePath: "/SSOViews" });
const authenticatedServer = await readAuthenticatedServer(address);
const localApiClient = createApiClient(address, authenticatedServer);

window.ApiClient = localApiClient;

export default localApiClient;
