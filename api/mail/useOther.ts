// mail.tm client — https://docs.mail.tm
// usage:
//   const box = await createMailbox();
//   const msg = await box.waitForMessage({ from: "noreply@example.com" });

const BASE_URL = "https://api.mail.tm";

export interface Domain {
  id: string;
  domain: string;
  isActive: boolean;
  isPrivate: boolean;
}

export interface Account {
  id: string;
  address: string;
  quota: number;
  used: number;
  isDisabled: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Address {
  address: string;
  name: string;
}

export interface MessageSummary {
  id: string;
  accountId: string;
  msgid: string;
  from: Address;
  to: Address[];
  subject: string;
  intro: string;
  seen: boolean;
  isDeleted: boolean;
  hasAttachments: boolean;
  size: number;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message extends MessageSummary {
  cc: Address[];
  bcc: Address[];
  text: string;
  html: string[];
  attachments: unknown[];
}

export interface WaitOptions {
  from?: string;
  subject?: string | RegExp;
  filter?: (msg: MessageSummary) => boolean;
  timeout?: number;
  interval?: number;
}

export class MailTmError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "MailTmError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && "hydra:member" in data) {
    return (data as { "hydra:member": T[] })["hydra:member"];
  }
  return [];
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string; contentType?: string } = {},
  retries = 3,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["Content-Type"] = init.contentType ?? "application/json";

  const res = await fetch(BASE_URL + path, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (res.status === 429 && retries > 0) {
    await sleep(1000);
    return request<T>(path, init, retries - 1);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    const detail =
      (body as { detail?: string; "hydra:description"?: string } | undefined)?.detail ??
      (body as { "hydra:description"?: string } | undefined)?.["hydra:description"] ??
      res.statusText;
    throw new MailTmError(`mail.tm ${init.method ?? "GET"} ${path} failed (${res.status}): ${detail}`, res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}


export async function getDomains(): Promise<Domain[]> {
  const data = await request<unknown>("/domains");
  return unwrapList<Domain>(data).filter((d) => d.isActive && !d.isPrivate);
}

export function createAccount(address: string, password: string): Promise<Account> {
  return request<Account>("/accounts", { method: "POST", body: { address, password } });
}

export async function getToken(address: string, password: string): Promise<string> {
  const data = await request<{ id: string; token: string }>("/token", {
    method: "POST",
    body: { address, password },
  });
  return data.token;
}

export function getMe(token: string): Promise<Account> {
  return request<Account>("/me", { token });
}

export async function listMessages(token: string, page = 1): Promise<MessageSummary[]> {
  const data = await request<unknown>(`/messages?page=${page}`, { token });
  return unwrapList<MessageSummary>(data);
}

export function getMessage(token: string, id: string): Promise<Message> {
  return request<Message>(`/messages/${id}`, { token });
}

export function markSeen(token: string, id: string): Promise<void> {
  return request<void>(`/messages/${id}`, {
    method: "PATCH",
    body: { seen: true },
    token,
    contentType: "application/merge-patch+json",
  });
}

export function deleteMessage(token: string, id: string): Promise<void> {
  return request<void>(`/messages/${id}`, { method: "DELETE", token });
}

export function deleteAccount(token: string, accountId: string): Promise<void> {
  return request<void>(`/accounts/${accountId}`, { method: "DELETE", token });
}


export class Mailbox {
  constructor(
    public readonly account: Account,
    public readonly password: string,
    public readonly token: string,
  ) {}

  get address() {
    return this.account.address;
  }

  messages(page = 1) {
    return listMessages(this.token, page);
  }

  read(id: string) {
    return getMessage(this.token, id);
  }

  markSeen(id: string) {
    return markSeen(this.token, id);
  }

  deleteMessage(id: string) {
    return deleteMessage(this.token, id);
  }

  destroy() {
    return deleteAccount(this.token, this.account.id);
  }

  async waitForMessage(opts: WaitOptions = {}): Promise<Message> {
    const { timeout = 60_000, interval = 3_000 } = opts;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const match = (await this.messages()).find((m) => matches(m, opts));
      if (match) return this.read(match.id);
      await sleep(interval);
    }

    throw new MailTmError(`no matching message for ${this.address} within ${timeout}ms`, 408);
  }
}

function matches(msg: MessageSummary, opts: WaitOptions): boolean {
  if (opts.from && msg.from.address.toLowerCase() !== opts.from.toLowerCase()) return false;
  if (opts.subject) {
    const ok =
      typeof opts.subject === "string" ? msg.subject.includes(opts.subject) : opts.subject.test(msg.subject);
    if (!ok) return false;
  }
  return opts.filter ? opts.filter(msg) : true;
}

function randomString(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export interface CreateMailboxOptions {
  username?: string;
  domain?: string;
  password?: string;
}

export async function createMailbox(opts: CreateMailboxOptions = {}): Promise<Mailbox> {
  let domain = opts.domain;
  if (!domain) {
    const domains = await getDomains();
    if (!domains[0]) throw new MailTmError("mail.tm returned no active domains", 503);
    domain = domains[0].domain;
  }

  const address = `${opts.username ?? randomString(12)}@${domain}`.toLowerCase();
  const password = opts.password ?? randomString(16);

  const account = await createAccount(address, password);
  const token = await getToken(address, password);
  return new Mailbox(account, password, token);
}

export async function loginMailbox(address: string, password: string): Promise<Mailbox> {
  const token = await getToken(address, password);
  const account = await getMe(token);
  return new Mailbox(account, password, token);
}
