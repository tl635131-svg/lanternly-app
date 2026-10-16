"use client";
import { useState } from "react";
import type { ShareKit } from "@/lib/types";
import { useCopy } from "@/lib/hooks";
import { Button, ButtonLink, cx } from "@/components/ui/primitives";
import { IconCheck, IconCopy, IconDownload, IconQr, IconShare } from "@/components/ui/icons";

export function CopyField({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-stretch gap-2">
      <label className="sr-only" htmlFor={"cf-" + label}>{label}</label>
      <input id={"cf-" + label} readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 truncate rounded-md border border-line bg-surface-2 px-3 font-mono text-sm" />
      <Button type="button" variant="outline" onClick={() => copy(value)} aria-label={`Copy ${label}`}>
        {copied ? <IconCheck size={18} className="text-success" /> : <IconCopy size={18} />}<span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
      </Button>
      <span className="sr-only" aria-live="polite">{copied ? "Copied to clipboard" : ""}</span>
    </div>
  );
}

export function ShareActions({ url, title, qrBase }: { url: string; title: string; qrBase: string }) {
  const [showQr, setShowQr] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  return (
    <div>
      <CopyField value={url} label="invitation link" />
      <div className="mt-3 flex flex-wrap gap-2">
        {canShare && <Button variant="outline" size="sm" onClick={() => navigator.share({ title, url }).catch(() => {})}><IconShare size={16} />Share</Button>}
        <Button variant="outline" size="sm" aria-expanded={showQr} onClick={() => setShowQr(!showQr)}><IconQr size={16} />{showQr ? "Hide QR code" : "Show QR code"}</Button>
        <ButtonLink variant="ghost" size="sm" href={`${qrBase}${qrBase.includes("?") ? "&" : "?"}format=png&size=1024&download=1`} download><IconDownload size={16} />PNG</ButtonLink>
        <ButtonLink variant="ghost" size="sm" href={`${qrBase}${qrBase.includes("?") ? "&" : "?"}format=svg&download=1`} download><IconDownload size={16} />SVG</ButtonLink>
      </div>
      <div className={cx("overflow-hidden transition-all", showQr ? "mt-4 max-h-80" : "max-h-0")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {showQr && <img src={`${qrBase}${qrBase.includes("?") ? "&" : "?"}format=svg`} alt={`QR code for ${url}`} width={200} height={200} className="rounded-md border border-line bg-white p-2" />}
      </div>
    </div>
  );
}

const LANG_NAMES: Record<string, string> = { en: "English", fr: "French", es: "Spanish", de: "German", it: "Italian", pt: "Portuguese", nl: "Dutch", sv: "Swedish", pl: "Polish" };
export const langName = (code: string) => LANG_NAMES[code.split("-")[0]] ?? code.toUpperCase();

/** Ready-made share messages from GET /share-kit. Templates exist only for `supportedTextLanguages` (en, fr). */
export function ShareKitPanel({ kit, eventId, title }: { kit: ShareKit; eventId: string; title: string }) {
  const langs = Object.keys(kit.texts);
  const [lang, setLang] = useState(langs.includes(kit.textLanguage) ? kit.textLanguage : langs[0] ?? "en");
  const [own, setOwn] = useState<Record<string, string>>({});
  const { copied, copy } = useCopy();
  const message = kit.texts[lang] ?? "";
  return (
    <div className="flex flex-col gap-4">
      <ShareActions url={kit.url} title={title} qrBase={`/api/events/${eventId}/qr`} />
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Ready-to-send message</h3>
          {langs.length > 1 && (
            <div role="radiogroup" aria-label="Message language" className="inline-flex rounded-md border border-line bg-surface-2 p-0.5">
              {langs.map((l) => (
                <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => setLang(l)} className={cx("rounded-sm px-2.5 py-1 text-xs font-semibold", lang === l ? "bg-surface text-ink shadow-card" : "text-muted")}>{langName(l)}</button>
              ))}
            </div>
          )}
        </div>
        <label htmlFor={`kit-msg-${lang}`} className="sr-only">Message in {langName(lang)}</label>
        <textarea id={`kit-msg-${lang}`} readOnly value={message} rows={4} className="mt-2 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm" />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => copy(message)}>{copied ? <IconCheck size={16} className="text-success" /> : <IconCopy size={16} />}{copied ? "Copied" : "Copy message"}</Button>
          <ButtonLink href={kit.whatsapp} target="_blank" rel="noopener noreferrer" variant="outline" size="sm">WhatsApp</ButtonLink>
          <ButtonLink href={kit.sms} variant="outline" size="sm">Text message</ButtonLink>
          <ButtonLink href={kit.email.mailto} variant="outline" size="sm">Email</ButtonLink>
        </div>
        <p className="mt-2 text-xs text-muted">The WhatsApp, text and email buttons use the {langName(kit.textLanguage)} message.</p>
      </div>
      {kit.untranslatedLanguages.length > 0 && (
        <div className="rounded-md border border-dashed border-line p-3">
          <p className="text-sm">
            We don&apos;t have a ready-made message in {kit.untranslatedLanguages.map(langName).join(" or ")} yet. Ready-made messages are available in {kit.supportedTextLanguages.map(langName).join(" and ")}. Write your own below:
          </p>
          {kit.untranslatedLanguages.map((l) => {
            const text = own[l] ?? "";
            const full = text.includes(kit.url) ? text : `${text}${text ? "\n" : ""}${kit.url}`;
            return (
              <div key={l} className="mt-3">
                <label htmlFor={`own-${l}`} className="text-sm font-semibold">Your message in {langName(l)}</label>
                <textarea id={`own-${l}`} rows={3} value={text} onChange={(e) => setOwn({ ...own, [l]: e.target.value })} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" placeholder="Write a short note. We'll add your link at the end." />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={!text.trim()} onClick={() => copy(full)}><IconCopy size={16} />Copy with link</Button>
                  {text.trim() && <ButtonLink href={`https://wa.me/?text=${encodeURIComponent(full)}`} target="_blank" rel="noopener noreferrer" variant="outline" size="sm">WhatsApp</ButtonLink>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
