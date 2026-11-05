interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  APP_PASSCODE: string;
  SESSION_SECRET: string;
  CLAUDE_MODEL: string;
  MOCK_AI?: string;
}
