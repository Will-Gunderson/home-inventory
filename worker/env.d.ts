interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  AI: Ai;
  ANTHROPIC_API_KEY: string;
  APP_PASSCODE: string;
  SESSION_SECRET: string;
  CLAUDE_MODEL: string;
  MOCK_AI?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_RU_NAME?: string;
  EBAY_ENV?: string; // "sandbox" to test against sandbox.ebay.com
}
