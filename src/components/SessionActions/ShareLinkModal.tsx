/**
 * The Share dialog of Discover and Visualize (DISC-SESSION-01, PARITY-DASHBOARDS): a "Use absolute
 * time range" switch, an optional warning, and Copy link. The link is shortened through Grafana's
 * short URL API (`/goto/<uid>`, data/shortUrl.ts) while "Short link" is on; until the short link is
 * ready, or if shortening fails, the full link is shown and copied.
 */
import React, { ReactNode, useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { AppEvents, GrafanaTheme2 } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { ClipboardButton, Field, Input, Modal, Spinner, Switch, useStyles2 } from '@grafana/ui';
import { shortenUrl } from '../../data/shortUrl';

export interface ShareLinkModalProps {
  title: string;
  isOpen: boolean;
  onDismiss: () => void;
  /** The full link for the current absolute-time choice. */
  buildUrl: (absolute: boolean) => string;
  /** False when the range is already absolute (the switch is then on and disabled). */
  relative: boolean;
  /** Shown above the link (e.g. Discover's unsaved-changes warning). */
  notice?: ReactNode;
  /** Shortener, injectable for tests. */
  shorten?: (url: string) => Promise<string>;
}

function notifyCopied() {
  getAppEvents().publish({ type: AppEvents.alertSuccess.name, payload: ['Link copied'] });
}

export function ShareLinkModal({
  title,
  isOpen,
  onDismiss,
  buildUrl,
  relative,
  notice,
  shorten = shortenUrl,
}: ShareLinkModalProps) {
  const styles = useStyles2(getStyles);
  const [absolute, setAbsolute] = useState(false);
  const [short, setShort] = useState(true);
  const fullUrl = isOpen ? buildUrl(absolute) : '';
  // The short link of `fullUrl` once Grafana returned it (keyed, so a stale answer is never shown).
  const [shortFor, setShortFor] = useState<{ full: string; url: string } | null>(null);

  useEffect(() => {
    if (!isOpen || !short || !fullUrl) {
      return;
    }
    let cancelled = false;
    shorten(fullUrl).then((url) => {
      if (!cancelled) {
        setShortFor({ full: fullUrl, url });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, short, fullUrl, shorten]);

  const pending = short && shortFor?.full !== fullUrl;
  const link = short && shortFor?.full === fullUrl ? shortFor.url : fullUrl;

  return (
    <Modal title={title} isOpen={isOpen} onDismiss={onDismiss}>
      <div className={styles.body}>
        <Field
          label="Use absolute time range"
          description={
            relative
              ? 'Off: the link keeps the relative range (e.g. "Last 15 minutes"), so it shows the latest data whenever it is opened. On: the link pins the exact range shown now.'
              : 'The current range is already absolute.'
          }
        >
          <Switch
            id="share-absolute-time"
            value={absolute || !relative}
            disabled={!relative}
            onChange={(e) => setAbsolute(e.currentTarget.checked)}
          />
        </Field>
        <Field label="Short link" description="A short /goto/ link from Grafana (signed-in users of this Grafana only)">
          <Switch id="share-short-link" value={short} onChange={(e) => setShort(e.currentTarget.checked)} />
        </Field>
        {notice}
        <Field label="Link">
          <Input
            readOnly
            value={link}
            aria-label="Share link"
            suffix={pending ? <Spinner size="sm" inline /> : undefined}
            addonAfter={
              <ClipboardButton
                variant="primary"
                icon="copy"
                disabled={pending}
                getText={() => link}
                onClipboardCopy={notifyCopied}
              >
                Copy link
              </ClipboardButton>
            }
          />
        </Field>
      </div>
    </Modal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  body: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
  `,
});
