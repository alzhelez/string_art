"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dismiss, isDismissed, isNewer, latestRelease, type Release } from "@/lib/update";
import { Icon } from "./ui/Icon";

/** Только в программе для Windows: «вышла новая версия — скачать?». */
export function UpdateNotice() {
  const [update, setUpdate] = useState<{ current: string; release: Release } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const app = await api.appInfo().catch(() => null);
      if (!app?.desktop || app.version === "dev") return;
      const release = await latestRelease();
      if (alive && release && isNewer(release.version, app.version) && !isDismissed(release.version)) {
        setUpdate({ current: app.version, release });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!update) return null;
  return (
    <div className="update-notice" role="status" data-testid="update-notice">
      <Icon name="download" size={18} />
      <span>
        Вышла новая версия <strong>{update.release.version}</strong> (у вас {update.current}). Портреты при обновлении
        сохранятся.
      </span>
      <a className="btn primary small" href={update.release.url} target="_blank" rel="noreferrer">
        Скачать
      </a>
      <button
        type="button"
        className="btn ghost small"
        onClick={() => {
          dismiss(update.release.version);
          setUpdate(null);
        }}
      >
        Позже
      </button>
    </div>
  );
}
