import type {
  SpotifyItemsPage,
  SpotifyPlaylistItem,
  SpotifyPlaylistMetadata,
  SpotifyProfile,
  SpotifyTokenResponse,
} from "./types.js";

const ACCOUNTS_URL = "https://accounts.spotify.com";
const API_URL = "https://api.spotify.com/v1";

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

interface Credentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class SpotifyClient {
  constructor(private readonly credentials: Credentials) {}

  authorizationUrl(state: string): string {
    const url = new URL("/authorize", ACCOUNTS_URL);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.credentials.clientId,
      scope: "playlist-read-private playlist-read-collaborative",
      redirect_uri: this.credentials.redirectUri,
      state,
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string): Promise<SpotifyTokenResponse> {
    return this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.credentials.redirectUri,
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<SpotifyTokenResponse> {
    return this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  private async tokenRequest(body: Record<string, string>): Promise<SpotifyTokenResponse> {
    const basic = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`,
    ).toString("base64");
    const response = await fetch(`${ACCOUNTS_URL}/api/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(15_000),
    });
    return this.readJson<SpotifyTokenResponse>(response, "Spotify token request failed");
  }

  async getProfile(accessToken: string): Promise<SpotifyProfile> {
    return this.apiRequest<SpotifyProfile>("/me", accessToken);
  }

  async getPlaylistMetadata(
    playlistId: string,
    accessToken: string,
  ): Promise<SpotifyPlaylistMetadata> {
    const fields = [
      "id",
      "name",
      "description",
      "snapshot_id",
      "external_urls",
      "images",
      "owner(display_name)",
      "items(total)",
    ].join(",");
    return this.apiRequest<SpotifyPlaylistMetadata>(
      `/playlists/${encodeURIComponent(playlistId)}?fields=${encodeURIComponent(fields)}`,
      accessToken,
    );
  }

  async getAllPlaylistItems(
    playlistId: string,
    accessToken: string,
  ): Promise<SpotifyPlaylistItem[]> {
    const allItems: SpotifyPlaylistItem[] = [];
    let next: string | null = `${API_URL}/playlists/${encodeURIComponent(playlistId)}/items?limit=50&additional_types=track%2Cepisode`;

    while (next) {
      const page: SpotifyItemsPage = await this.apiRequest<SpotifyItemsPage>(next, accessToken);
      allItems.push(...page.items);
      next = page.next;
    }
    return allItems;
  }

  private async apiRequest<T>(pathOrUrl: string, accessToken: string): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API_URL}${pathOrUrl}`;
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    return this.readJson<T>(response, "Spotify API request failed");
  }

  private async readJson<T>(response: Response, fallback: string): Promise<T> {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string | { message?: string } }
      | null;
    if (!response.ok) {
      const apiMessage =
        typeof payload?.error === "string" ? payload.error : payload?.error?.message;
      const retryHeader = response.headers.get("retry-after");
      const retryAfter = retryHeader ? Number.parseInt(retryHeader, 10) : undefined;
      throw new SpotifyApiError(
        apiMessage || `${fallback} (${response.status})`,
        response.status,
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    return payload as T;
  }
}
