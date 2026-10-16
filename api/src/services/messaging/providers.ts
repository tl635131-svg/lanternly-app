import { randomUUID } from 'node:crypto';
import type { Rendered } from '../email/templates.js';

export interface OutboundMessage {
  to: string;
  rendered: Rendered;
  templateKey: string;
}
export interface SendResult {
  providerMessageId: string;
}

/** A delivery channel (email, WhatsApp, SMS). Real providers (Resend/Postmark/SES, WhatsApp Business, Twilio) implement this. */
export interface ChannelProvider {
  readonly name: string;
  readonly available: boolean;
  send(msg: OutboundMessage): Promise<SendResult>;
}

export interface DevOutboxEntry {
  id: string;
  to: string;
  templateKey: string;
  subject: string;
  text: string;
  at: string;
}
const outbox: DevOutboxEntry[] = [];

/** Dev/console email driver: NEVER sends — logs the message and keeps it in an in-memory outbox (dev & tests only). */
export class ConsoleEmailProvider implements ChannelProvider {
  readonly name = 'console';
  readonly available = true;
  constructor(private log: (line: string) => void = (l) => console.log(l)) {}
  async send(msg: OutboundMessage): Promise<SendResult> {
    const id = `console_${randomUUID()}`;
    outbox.unshift({ id, to: msg.to, templateKey: msg.templateKey, subject: msg.rendered.subject, text: msg.rendered.text, at: new Date().toISOString() });
    if (outbox.length > 200) outbox.length = 200;
    if (process.env.NODE_ENV !== 'test') {
      this.log(`\n📧 [console email — not sent] to=${msg.to} template=${msg.templateKey}\n   subject: ${msg.rendered.subject}\n   ${msg.rendered.text.replace(/\n/g, '\n   ')}\n`);
    }
    return { providerMessageId: id };
  }
}

/** WhatsApp: later channel. Interface reserved; no provider wired, so it reports unavailable. */
export class WhatsAppStubProvider implements ChannelProvider {
  readonly name = 'whatsapp-stub';
  readonly available = false;
  async send(): Promise<SendResult> {
    throw new Error('WhatsApp sending is not available yet. Use personal links with wa.me share URLs instead.');
  }
}
export class SmsStubProvider implements ChannelProvider {
  readonly name = 'sms-stub';
  readonly available = false;
  async send(): Promise<SendResult> {
    throw new Error('SMS sending is not available yet.');
  }
}

export function getDevOutbox(): DevOutboxEntry[] {
  return outbox;
}
export function clearDevOutbox() {
  outbox.length = 0;
}

export const providers = {
  email: new ConsoleEmailProvider(),
  whatsapp: new WhatsAppStubProvider(),
  sms: new SmsStubProvider(),
};
