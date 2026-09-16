// tests/stubs/next-server.ts
// Stub for Next.js server module in unit test environments

export class NextResponse extends Response {
  static json(data: any, init?: ResponseInit) {
    return new Response(JSON.stringify(data), {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  }
}

export class NextRequest extends Request {
  public nextUrl: URL;
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init);
    this.nextUrl = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
  }
}
