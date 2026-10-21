"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  DEFAULT_PRICING_SETTINGS,
  type PricingSettings
} from "@/lib/pricing";

type Mode = "loading" | "login" | "settings";

export default function AdminPage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [email, setEmail] = useState("kayatech3d@gmail.com");
  const [password, setPassword] = useState("");
  const [settings, setSettings] = useState<PricingSettings>(DEFAULT_PRICING_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadSettings() {
    try {
      const response = await fetch("/api/admin/settings", { cache: "no-store" });
      if (response.status === 401) {
        setMode("login");
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Ayarlar alınamadı.");
      setSettings(data);
      setMode("settings");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ayarlar alınamadı.");
      setMode("login");
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Giriş başarısız.");
      setPassword("");
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Giriş başarısız.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Ayarlar kaydedilemedi.");
      setSettings(data.settings);
      setNotice("Ayarlar kaydedildi. Yeni teklifler bu değerleri kullanacak.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ayarlar kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
      setMode("login");
      setSettings(DEFAULT_PRICING_SETTINGS);
      setNotice("");
      setError("");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "loading") {
    return <main className="adminShell"><div className="adminCard"><p className="adminEyebrow">KAYATECH3D · YÖNETİM</p><h1>Kontrol ediliyor…</h1></div></main>;
  }

  return (
    <main className="adminShell">
      <header className="adminNav">
        <a className="brand" href="/"><span className="brandMark">K</span>KAYATECH<span className="brandLight">3D</span></a>
        <a className="adminBack" href="/">Teklif sayfasına dön ↗</a>
      </header>

      {mode === "login" ? (
        <section className="adminCard adminLoginCard">
          <p className="adminEyebrow">YETKİLİ ERİŞİM</p>
          <h1>Yönetici girişi</h1>
          <p className="adminIntro">Fiyatlandırma ayarlarını düzenlemek için giriş yap.</p>
          <form className="adminForm" onSubmit={handleLogin}>
            <label htmlFor="admin-email">E-posta</label>
            <input id="admin-email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required />
            <label htmlFor="admin-password">Şifre</label>
            <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
            <button className="primary" type="submit" disabled={busy}>{busy ? "Kontrol ediliyor…" : "Giriş yap ↗"}</button>
          </form>
          {error && <div className="error" role="alert">{error}</div>}
          <p className="adminFootnote">Giriş bilgileri sunucu ortam değişkenleriyle doğrulanır; şifre bu sayfanın kodunda tutulmaz.</p>
        </section>
      ) : (
        <section className="adminCard">
          <div className="adminTitleRow">
            <div><p className="adminEyebrow">KAYATECH3D · YÖNETİM</p><h1>Fiyatlandırma ayarları</h1><p className="adminIntro">Buradaki değerler yeni teklif hesaplamalarında kullanılır.</p></div>
            <button type="button" className="adminSecondary" onClick={logout} disabled={busy}>Çıkış yap</button>
          </div>
          <form className="adminForm" onSubmit={saveSettings}>
            <div className="adminField">
              <label htmlFor="filament-price">Filament ücreti (TL / gram)</label>
              <input id="filament-price" type="number" min="0" max="1000000" step="0.01" value={settings.filamentPricePerGram} onChange={event => setSettings(current => ({ ...current, filamentPricePerGram: Number(event.target.value) }))} required />
              <small>Filament tüketimi (gram) × bu değer.</small>
            </div>
            <div className="adminField">
              <label htmlFor="machine-price">Makine ücreti (TL / saat)</label>
              <input id="machine-price" type="number" min="0" max="1000000" step="0.01" value={settings.machinePricePerHour} onChange={event => setSettings(current => ({ ...current, machinePricePerHour: Number(event.target.value) }))} required />
              <small>Baskı süresi saniyeden saate çevrilir, ardından bu değerle çarpılır.</small>
            </div>
            <div className="adminField">
              <label htmlFor="paint-fee">Boya işçiliği (TL / model)</label>
              <input id="paint-fee" type="number" min="0" max="1000000" step="0.01" value={settings.paintLaborFee} onChange={event => setSettings(current => ({ ...current, paintLaborFee: Number(event.target.value) }))} required />
              <small>Boyasız seçeneğinde uygulanmaz; renkli boya seçilince bir defa eklenir.</small>
            </div>
            <div className="adminFormula"><span>Hesaplama</span><strong>(gram × filament TL/g) + (saat × makine TL/saat) + boya işçiliği</strong></div>
            <button className="primary" type="submit" disabled={busy}>{busy ? "Kaydediliyor…" : "Ayarları kaydet"}</button>
          </form>
          {error && <div className="error" role="alert">{error}</div>}
          {notice && <div className="adminSuccess" role="status">{notice}</div>}
          <p className="adminFootnote">Ayarlar Cloudflare R2 üzerinde saklanır; sayfa yenilendiğinde de korunur.</p>
        </section>
      )}
    </main>
  );
}
