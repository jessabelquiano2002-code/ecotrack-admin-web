"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { onValue, push, ref, update } from "@/lib/offlineFirebaseDatabase";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import styles from "./driver-messages.module.css";

type Driver = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  truck?: string;
  vehicle?: string;
  status?: string;
  assignedRouteId?: string;
  assignedRouteName?: string;
  assignedVehicle?: string;
  profileImage?: string;
};

type AdminProfile = {
  id?: string;
  name?: string;
  role?: string;
  profileImage?: string;
};

type ChatMeta = {
  driverId?: string;
  driverName?: string;
  adminId?: string;
  adminName?: string;
  adminProfileImage?: string;
  lastMessage?: string;
  lastMessageAt?: number;
  lastSenderRole?: "admin" | "driver" | string;
  unreadForAdmin?: number;
  updatedAt?: number;
};

type ChatMessage = {
  id: string;
  senderId?: string;
  senderRole?: "admin" | "driver" | string;
  senderName?: string;
  messageType?: "text" | "image" | "image_text" | string;
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  createdAt?: number;
  readByAdminAt?: number;
  readByDriverAt?: number;
};

type PreparedImage = {
  base64: string;
  mimeType: string;
  previewUrl: string;
  fileName: string;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "D";
  return parts.slice(0, 2).map((part) => part[0].toUpperCase()).join("");
}

function imageSource(value?: string): string {
  const source = clean(value);
  if (!source) return "";
  if (source.startsWith("data:") || source.startsWith("http://") || source.startsWith("https://") || source.startsWith("blob:")) {
    return source;
  }
  return `data:image/jpeg;base64,${source}`;
}

function formatTime(value?: number): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "";
  }
}

function formatConversationTime(value?: number): string {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const sameDate = date.toDateString() === now.toDateString();
  try {
    return new Intl.DateTimeFormat("en-PH", sameDate
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric" }).format(date);
  } catch {
    return "";
  }
}

function Avatar({
  name,
  profileImage,
  className,
}: {
  name: string;
  profileImage?: string;
  className: string;
}) {
  const src = imageSource(profileImage);
  return (
    <span className={className} aria-label={`${name} profile picture`}>
      {src ? <img src={src} alt="" /> : <span>{initials(name)}</span>}
    </span>
  );
}

function estimateBase64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to open the selected image."));
    image.src = source;
  });
}

async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error("Please select an image file.");

  const inputDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(inputDataUrl);
  const maxSide = 1280;
  let width = image.naturalWidth || image.width;
  let height = image.naturalHeight || image.height;

  if (width > height && width > maxSide) {
    height = Math.round((height * maxSide) / width);
    width = maxSide;
  } else if (height >= width && height > maxSide) {
    width = Math.round((width * maxSide) / height);
    height = maxSide;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare the selected image.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = 0.86;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  let base64 = dataUrl.split(",")[1] || "";

  while (estimateBase64Bytes(base64) > 360_000 && quality > 0.42) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    base64 = dataUrl.split(",")[1] || "";
  }

  if (!base64 || estimateBase64Bytes(base64) > 500_000) {
    throw new Error("The selected image is still too large after compression.");
  }

  return {
    base64,
    mimeType: "image/jpeg",
    previewUrl: dataUrl,
    fileName: file.name || "chat-photo.jpg",
  };
}

export default function DriverMessagesPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [chatMeta, setChatMeta] = useState<Record<string, ChatMeta>>({});
  const [adminProfile, setAdminProfile] = useState<AdminProfile>({ name: "WasteTrack Admin" });
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [preparingImage, setPreparingImage] = useState(false);
  const [selectedImage, setSelectedImage] = useState<PreparedImage | null>(null);
  const [notice, setNotice] = useState("");
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [previewImage, setPreviewImage] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onValue(ref(db, "drivers"), (snapshot) => {
      const raw = snapshot.val() || {};
      const list = Object.entries(raw)
        .map(([id, value]) => ({ id, ...(value as Omit<Driver, "id">) }))
        .sort((a, b) => clean(a.name || a.id).localeCompare(clean(b.name || b.id)));
      setDrivers(list);
      setLoadingDrivers(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onValue(ref(db, "driver_admin_chat_meta"), (snapshot) => {
      setChatMeta(snapshot.val() || {});
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeProfile?.();
      if (!user) {
        setAdminProfile({ name: "WasteTrack Admin" });
        return;
      }
      unsubscribeProfile = onValue(ref(db, `adminProfile/${user.uid}`), (snapshot) => {
        const value = snapshot.val() || {};
        setAdminProfile({
          id: user.uid,
          name: clean(value.name) || "WasteTrack Admin",
          role: clean(value.role) || "System Admin",
          profileImage: clean(value.profileImage),
        });
      });
    });
    return () => {
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    if (!selectedDriverId) {
      setMessages([]);
      setSelectedImage(null);
      return;
    }

    const unsubscribe = onValue(ref(db, `driver_admin_chats/${selectedDriverId}/messages`), (snapshot) => {
      const raw = snapshot.val() || {};
      const list = Object.entries(raw)
        .map(([id, value]) => ({ id, ...(value as Omit<ChatMessage, "id">) }))
        .filter((item) => clean(item.text) || clean(item.imageBase64))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
        .slice(-200);
      setMessages(list);

      const now = Date.now();
      const readUpdates: Record<string, unknown> = {};
      list.forEach((message) => {
        if (clean(message.senderRole).toLowerCase() === "driver" && !message.readByAdminAt) {
          readUpdates[`driver_admin_chats/${selectedDriverId}/messages/${message.id}/readByAdminAt`] = now;
        }
      });
      if (Object.keys(readUpdates).length > 0) {
        readUpdates[`driver_admin_chat_meta/${selectedDriverId}/unreadForAdmin`] = 0;
        void update(ref(db), readUpdates);
      }
    });

    return () => unsubscribe();
  }, [selectedDriverId]);

  useEffect(() => {
    if (!selectedDriverId || !adminProfile.id) return;
    void update(ref(db, `driver_admin_chat_meta/${selectedDriverId}`), {
      adminId: adminProfile.id,
      adminName: adminProfile.name || "WasteTrack Admin",
      adminProfileImage: adminProfile.profileImage || "",
    });
  }, [selectedDriverId, adminProfile]);

  useEffect(() => {
    const timer = window.setTimeout(() => threadEndRef.current?.scrollIntoView({ block: "end" }), 40);
    return () => window.clearTimeout(timer);
  }, [messages, selectedDriverId]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return drivers
      .filter((driver) => {
        if (!query) return true;
        return [
          driver.name,
          driver.email,
          driver.phone,
          driver.truck,
          driver.vehicle,
          driver.assignedRouteName,
          driver.assignedVehicle,
        ].filter(Boolean).join(" ").toLowerCase().includes(query);
      })
      .sort((a, b) => {
        const aTime = Number(chatMeta[a.id]?.lastMessageAt || 0);
        const bTime = Number(chatMeta[b.id]?.lastMessageAt || 0);
        if (aTime !== bTime) return bTime - aTime;
        return clean(a.name || a.id).localeCompare(clean(b.name || b.id));
      });
  }, [drivers, chatMeta, search]);

  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId) || null;
  const totalUnread = useMemo(
    () => Object.values(chatMeta).reduce((sum, item) => sum + Math.max(0, Number(item.unreadForAdmin || 0)), 0),
    [chatMeta],
  );

  const clearImage = () => {
    setSelectedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const pickImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setPreparingImage(true);
      setNotice("");
      setSelectedImage(await prepareImage(file));
    } catch (error) {
      clearImage();
      setNotice(error instanceof Error ? error.message : "Unable to prepare the selected image.");
    } finally {
      setPreparingImage(false);
    }
  };

  const sendMessage = async () => {
    const text = draft.trim();
    const hasImage = Boolean(selectedImage?.base64);
    if (!selectedDriver || (!text && !hasImage) || sending || preparingImage) return;

    const messageRef = push(ref(db, `driver_admin_chats/${selectedDriver.id}/messages`));
    const messageId = messageRef.key;
    if (!messageId) {
      setNotice("Unable to create a message ID.");
      return;
    }

    const now = Date.now();
    const adminId = auth.currentUser?.uid || adminProfile.id || "admin";
    const adminName = adminProfile.name || "WasteTrack Admin";
    const preview = text || "Photo";
    const payload: Omit<ChatMessage, "id"> = {
      senderId: adminId,
      senderRole: "admin",
      senderName: adminName,
      messageType: hasImage ? (text ? "image_text" : "image") : "text",
      text,
      createdAt: now,
      ...(hasImage ? {
        imageBase64: selectedImage?.base64,
        imageMimeType: selectedImage?.mimeType || "image/jpeg",
      } : {}),
    };

    try {
      setSending(true);
      setNotice("");
      await update(ref(db), {
        [`driver_admin_chats/${selectedDriver.id}/messages/${messageId}`]: payload,
        [`driver_admin_chat_meta/${selectedDriver.id}/driverId`]: selectedDriver.id,
        [`driver_admin_chat_meta/${selectedDriver.id}/driverName`]: selectedDriver.name || "Driver",
        [`driver_admin_chat_meta/${selectedDriver.id}/adminId`]: adminId,
        [`driver_admin_chat_meta/${selectedDriver.id}/adminName`]: adminName,
        [`driver_admin_chat_meta/${selectedDriver.id}/adminProfileImage`]: adminProfile.profileImage || "",
        [`driver_admin_chat_meta/${selectedDriver.id}/lastMessage`]: preview,
        [`driver_admin_chat_meta/${selectedDriver.id}/lastMessageAt`]: now,
        [`driver_admin_chat_meta/${selectedDriver.id}/lastSenderRole`]: "admin",
        [`driver_admin_chat_meta/${selectedDriver.id}/updatedAt`]: now,
      });

      setDraft("");
      clearImage();

      const currentUser = auth.currentUser;
      if (currentUser) {
        try {
          const idToken = await currentUser.getIdToken();
          const response = await fetch("/api/driver-chat-notify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              driverId: selectedDriver.id,
              messageId,
              message: hasImage && !text ? "Photo" : preview,
            }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            setNotice(clean(result?.message) || "Message was saved, but the driver notification could not be confirmed.");
          } else if (Number(result?.sent || 0) === 0) {
            setNotice(clean(result?.warning) || "Message was saved. The driver has no reachable notification token yet.");
          }
        } catch {
          setNotice("Message was saved. The driver notification could not be confirmed.");
        }
      }
    } catch (error) {
      console.error("Unable to send driver message:", error);
      setNotice("Unable to save the message. Check Firebase access and try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <DashboardShell title="" description="">
      <main className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <span className={styles.eyebrow}>Operations communication</span>
            <h1>Driver messages</h1>
            <p>Private real-time conversations with collection drivers.</p>
          </div>
          <div className={styles.headerSummary}>
            <span>{loadingDrivers ? "—" : drivers.length} drivers</span>
            <span data-active={totalUnread > 0}><i />{totalUnread} unread</span>
          </div>
        </header>

        {notice ? <div className={styles.notice}><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div> : null}

        <section className={`${styles.messenger} ${selectedDriverId ? styles.hasSelection : ""}`}>
          <aside className={styles.sidebar}>
            <div className={styles.sidebarTitle}>
              <div><h2>Messages</h2><p>{rows.length} drivers</p></div>
              {totalUnread > 0 ? <b>{totalUnread > 99 ? "99+" : totalUnread}</b> : null}
            </div>
            <label className={styles.search}>
              <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search drivers" />
            </label>
            <div className={styles.driverList}>
              {rows.map((driver) => {
                const meta = chatMeta[driver.id];
                const unread = Math.max(0, Number(meta?.unreadForAdmin || 0));
                const online = clean(driver.status).toLowerCase() === "online";
                return (
                  <button key={driver.id} data-active={selectedDriverId === driver.id} className={styles.driverRow} onClick={() => setSelectedDriverId(driver.id)}>
                    <span className={styles.avatarWrap}>
                      <Avatar name={driver.name || "Driver"} profileImage={driver.profileImage} className={styles.avatar} />
                      <i data-online={online} />
                    </span>
                    <span className={styles.driverText}>
                      <span className={styles.driverNameLine}><strong>{driver.name || "Unnamed driver"}</strong><small>{formatConversationTime(meta?.lastMessageAt)}</small></span>
                      <span className={styles.driverPreview}>{meta?.lastMessage || driver.assignedRouteName || driver.truck || "No messages yet"}</span>
                    </span>
                    {unread > 0 ? <b className={styles.unreadBadge}>{unread > 99 ? "99+" : unread}</b> : null}
                  </button>
                );
              })}
            </div>
          </aside>

          <section className={styles.thread}>
            {!selectedDriver ? (
              <div className={styles.emptyThread}><h2>Select a conversation</h2><p>Choose a driver to view messages.</p></div>
            ) : (
              <>
                <header className={styles.threadHeader}>
                  <button className={styles.mobileBack} onClick={() => setSelectedDriverId("")} aria-label="Back">‹</button>
                  <Avatar name={selectedDriver.name || "Driver"} profileImage={selectedDriver.profileImage} className={styles.headerAvatar} />
                  <div className={styles.threadIdentity}>
                    <h2>{selectedDriver.name || "Unnamed driver"}</h2>
                    <p>{selectedDriver.assignedRouteName || "No route assigned"}{selectedDriver.truck || selectedDriver.assignedVehicle ? ` • ${selectedDriver.truck || selectedDriver.assignedVehicle}` : ""}</p>
                  </div>
                  <span className={styles.presence} data-online={clean(selectedDriver.status).toLowerCase() === "online"}><i />{clean(selectedDriver.status).toLowerCase() === "online" ? "Online" : "Offline"}</span>
                </header>

                <div className={styles.threadBody}>
                  <div className={styles.threadInner}>
                    {messages.length === 0 ? <div className={styles.firstMessage}>
                      <Avatar name={selectedDriver.name || "Driver"} profileImage={selectedDriver.profileImage} className={styles.firstAvatar} />
                      <strong>{selectedDriver.name || "Driver"}</strong>
                      <p>Start a private operations conversation.</p>
                    </div> : null}
                    {messages.map((message) => {
                      const outgoing = clean(message.senderRole).toLowerCase() === "admin";
                      return (
                        <div key={message.id} className={`${styles.messageRow} ${outgoing ? styles.outgoing : styles.incoming}`}>
                          {!outgoing ? <Avatar name={selectedDriver.name || "Driver"} profileImage={selectedDriver.profileImage} className={styles.messageAvatar} /> : null}
                          <div className={styles.messageStack}>
                            <div className={styles.bubble}>
                              {message.imageBase64 ? <button className={styles.imageButton} onClick={() => setPreviewImage(`data:${message.imageMimeType || "image/jpeg"};base64,${message.imageBase64}`)} aria-label="Open image"><img src={`data:${message.imageMimeType || "image/jpeg"};base64,${message.imageBase64}`} alt="Chat attachment" /></button> : null}
                              {clean(message.text) ? <p>{message.text}</p> : null}
                            </div>
                            <span className={styles.messageMeta}>{formatTime(message.createdAt)}{outgoing ? message.readByDriverAt ? " • Read" : " • Sent" : ""}</span>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={threadEndRef} />
                  </div>
                </div>

                <footer className={styles.composer}>
                  {selectedImage ? <div className={styles.attachmentPreview}>
                    <img src={selectedImage.previewUrl} alt="Selected attachment" />
                    <div><strong>{selectedImage.fileName}</strong><span>Ready to send</span></div>
                    <button onClick={clearImage} aria-label="Remove image">×</button>
                  </div> : null}
                  <div className={styles.composerShell}>
                    <input ref={fileInputRef} className={styles.fileInput} type="file" accept="image/*" onChange={pickImage} />
                    <button className={styles.attachButton} onClick={() => fileInputRef.current?.click()} disabled={sending || preparingImage} aria-label="Attach photo">
                      <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m5 17 4-4 3 3 3-4 4 5"/></svg>
                    </button>
                    <textarea rows={1} maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={preparingImage ? "Preparing photo…" : `Message ${selectedDriver.name?.split(" ")[0] || "driver"}`} onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }} />
                    <button className={styles.sendButton} disabled={(!draft.trim() && !selectedImage) || sending || preparingImage} onClick={() => void sendMessage()} aria-label="Send">
                      {sending ? "•••" : <svg viewBox="0 0 24 24"><path d="m3 11 18-8-8 18-2-7-8-3Z"/><path d="m11 14 5-5"/></svg>}
                    </button>
                  </div>
                </footer>
              </>
            )}
          </section>
        </section>
      </main>

      {previewImage ? <div className={styles.previewOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setPreviewImage(""); }}><div><button onClick={() => setPreviewImage("")}>×</button><img src={previewImage} alt="Full attachment" /></div></div> : null}
    </DashboardShell>
  );
}
