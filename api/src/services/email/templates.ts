/**
 * Transactional & guest message templates (original wording, English first; add locales by key).
 * Each template returns subject + plain text + minimal HTML. No passwords are ever included.
 */
export type TemplateKey =
  | 'order_confirmation'
  | 'set_password'
  | 'password_reset'
  | 'login_link'
  | 'new_order_studio'
  | 'brief_submitted_studio'
  | 'brief_sections_added'
  | 'draft_ready'
  | 'revision_received_studio'
  | 'revision_completed'
  | 'invitation_ready'
  | 'std_ready'
  | 'rsvp_received_host'
  | 'guest_rsvp_confirmation'
  | 'guest_invite'
  | 'guest_reminder'
  | 'guest_update'
  | 'guest_thank_you'
  | 'cohost_invite'
  | 'contact_studio'
  | 'deletion_request_studio'
  | 'custom';

export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

type D = Record<string, any>;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function wrap(subject: string, paragraphs: string[], cta?: { label: string; url: string }, footer?: string): Rendered {
  const text = [...paragraphs, cta ? `${cta.label}: ${cta.url}` : '', footer ?? ''].filter(Boolean).join('\n\n');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#222;max-width:560px;margin:auto;padding:24px">${paragraphs
    .map((p) => `<p>${esc(p)}</p>`)
    .join('')}${cta ? `<p><a href="${esc(cta.url)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#222;color:#fff;text-decoration:none">${esc(cta.label)}</a></p>` : ''}${
    footer ? `<p style="font-size:12px;color:#777">${esc(footer)}</p>` : ''
  }</body></html>`;
  return { subject, text, html };
}

const unsubscribeFooter = (d: D) => (d.unsubscribeUrl ? `Don't want these messages? Unsubscribe: ${d.unsubscribeUrl}` : undefined);

const templates: Record<TemplateKey, (d: D) => Rendered> = {
  order_confirmation: (d) =>
    wrap(`Order ${d.orderNumber} confirmed`, [`Hi ${d.name ?? 'there'},`, `Thank you — your ${d.planName} order (${d.orderNumber}) is confirmed. Total paid: ${d.total}.`, d.needsPassword ? 'Create your password to open your planning panel. This link works once and expires soon.' : 'Sign in to your planning panel to get started.'], { label: d.needsPassword ? 'Set my password' : 'Open my panel', url: d.actionUrl }),
  set_password: (d) => wrap('Set your password', [`Hi ${d.name ?? 'there'},`, 'Use the button below to choose your password. The link works once and expires in a few days.'], { label: 'Set my password', url: d.actionUrl }, 'If you did not expect this email you can ignore it.'),
  password_reset: (d) => wrap('Reset your password', ['We received a request to reset your password. The link below works once and expires in one hour.'], { label: 'Choose a new password', url: d.actionUrl }, 'If you did not ask for this, no action is needed.'),
  login_link: (d) => wrap('Your sign-in link', ['Here is your one-time sign-in link. It expires in 20 minutes.'], { label: 'Sign in', url: d.actionUrl }, 'If you did not ask for this, you can ignore it.'),
  new_order_studio: (d) => wrap(`New order ${d.orderNumber}`, [`Plan: ${d.planName}`, `Customer: ${d.email}`, `Event: ${d.title} on ${d.eventDate ?? 'TBD'}`, `Total: ${d.total}`]),
  brief_submitted_studio: (d) => wrap(`${d.isResubmit ? 'Brief resubmitted' : 'Brief submitted'}: ${d.title}`, [`${d.title} has ${d.isResubmit ? 'resubmitted' : 'submitted'} their brief.`], { label: 'Open in studio', url: d.adminUrl }),
  brief_sections_added: (d) => wrap('A few more details, please', [`Our studio added ${d.count} new section(s) to your brief. Your previous answers are safe — just complete the new ones and resubmit.`], { label: 'Complete my brief', url: d.panelUrl }),
  draft_ready: (d) => wrap('Your first draft is ready', [`Hi ${d.name ?? 'there'},`, `Your invitation draft is ready to review. You have ${d.roundsRemaining} revision round(s) available.`, d.note ?? ''].filter(Boolean), { label: 'Review my draft', url: d.panelUrl }),
  revision_received_studio: (d) => wrap(`Revision round ${d.round} — ${d.title}`, [d.request], { label: 'Open in studio', url: d.adminUrl }),
  revision_completed: (d) => wrap(`Revision round ${d.round} is done`, ['Your requested changes are ready to review.', d.staffNote ?? ''].filter(Boolean), { label: 'See the update', url: d.panelUrl }),
  invitation_ready: (d) => wrap('Your invitation is live', [`Hi ${d.name ?? 'there'},`, `Your invitation is published and ready to share: ${d.inviteUrl}`, 'You can download the QR code and follow replies from your panel.', d.note ?? ''].filter(Boolean), { label: 'Open my panel', url: d.panelUrl }),
  std_ready: (d) => wrap('Your save-the-date is ready', [`Share it with your guests: ${d.inviteUrl}`], { label: 'Open my panel', url: d.panelUrl }),
  rsvp_received_host: (d) => wrap(`New reply from ${d.guestName}`, [`${d.guestName} replied ${d.attendance === 'yes' ? 'yes' : 'no'}${d.attendance === 'yes' ? ` (party of ${d.partySize})` : ''}.`, d.message ? `Message: "${d.message}"` : ''].filter(Boolean), { label: 'See all replies', url: d.panelUrl }),
  guest_rsvp_confirmation: (d) => wrap(`Thanks for replying to ${d.title}`, [`Hi ${d.guestName},`, d.attendance === 'yes' ? `We've saved your reply — see you on ${d.dateText}!` : "We've saved your reply. You'll be missed!", 'Need to change something? Use the link below.'], { label: 'Edit my reply', url: d.editUrl }, unsubscribeFooter(d)),
  guest_invite: (d) => wrap(d.subject ?? `You're invited: ${d.title}`, [`Dear ${d.firstName},`, d.body ?? `${d.title} would love to celebrate with you. Open your personal invitation below.`], { label: 'Open my invitation', url: d.inviteUrl }, unsubscribeFooter(d)),
  guest_reminder: (d) => wrap(d.subject ?? `Reminder: please reply to ${d.title}`, [`Dear ${d.firstName},`, d.body ?? `Just a friendly reminder to let ${d.title} know if you can make it${d.deadline ? ` by ${d.deadline}` : ''}.`], { label: 'Reply now', url: d.inviteUrl }, unsubscribeFooter(d)),
  guest_update: (d) => wrap(d.subject ?? `An update from ${d.title}`, [`Dear ${d.firstName},`, d.body ?? 'There are some updates to the celebration details.'], { label: 'See the details', url: d.inviteUrl }, unsubscribeFooter(d)),
  guest_thank_you: (d) => wrap(d.subject ?? `Thank you from ${d.title}`, [`Dear ${d.firstName},`, d.body ?? 'Thank you for celebrating with us.'], d.inviteUrl ? { label: 'Open', url: d.inviteUrl } : undefined, unsubscribeFooter(d)),
  cohost_invite: (d) => wrap(`You've been invited to help plan ${d.title}`, [`${d.inviterName ?? 'A host'} invited you to join ${d.title} as ${d.role}. The link works once and expires in 7 days.`], { label: 'Accept invitation', url: d.actionUrl }),
  contact_studio: (d) => wrap(`Contact form: ${d.topic}`, [`From: ${d.name} <${d.email}>`, d.message]),
  deletion_request_studio: (d) => wrap(`Data deletion request: ${d.title}`, [`Requested by ${d.email} for event ${d.eventId}.`]),
  custom: (d) => wrap(d.subject ?? 'A message from our studio', [d.body ?? ''], d.url ? { label: d.urlLabel ?? 'Open', url: d.url } : undefined),
};

export function renderTemplate(key: TemplateKey, data: D, _locale = 'en'): Rendered {
  const t = templates[key];
  if (!t) throw new Error(`Unknown template ${key}`);
  return t(data);
}
