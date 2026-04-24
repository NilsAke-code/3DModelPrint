import { apiRequest } from "../auth/authConfig";
import { msalInstance } from "../auth/AuthProvider";
import type { Model3D, ModelFileEntry, Tag, UserInfo, AdminStats } from "../types";

const BASE = "/api";

export async function getAccessToken(): Promise<string | null> {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return null;

  try {
    const response = await msalInstance.acquireTokenSilent({
      ...apiRequest,
      account: accounts[0],
    });
    return response.accessToken;
  } catch {
    try {
      const response = await msalInstance.acquireTokenPopup(apiRequest);
      return response.accessToken;
    } catch {
      return null;
    }
  }
}

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated");

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

// ===== PUBLIC endpoints =====

export async function fetchModels(params?: {
  search?: string;
  category?: string;
  tag?: string;
  sort?: string;
}): Promise<Model3D[]> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.category) query.set("category", params.category);
  if (params?.tag) query.set("tag", params.tag);
  if (params?.sort) query.set("sort", params.sort);
  const res = await fetch(`${BASE}/models?${query}`);
  return res.json();
}

export async function fetchModel(id: number): Promise<Model3D> {
  const res = await fetch(`${BASE}/models/${id}`);
  if (!res.ok) throw new Error("Model not found");
  return res.json();
}

export async function toggleFavorite(id: number): Promise<boolean> {
  const res = await authFetch(`${BASE}/models/${id}/favorite`, { method: "POST" });
  if (!res.ok) throw new Error(`Toggle favorite failed: ${res.status}`);
  const data = await res.json();
  return data.isFavorite as boolean;
}

export async function fetchTags(): Promise<Tag[]> {
  const res = await fetch(`${BASE}/tags`);
  return res.json();
}

export async function fetchCategories(): Promise<string[]> {
  const res = await fetch(`${BASE}/categories`);
  return res.json();
}

export function getImageUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `/uploads/${path}`;
}

export function getThumbnailUrl(model: Model3D): string {
  if (model.images?.length > 0) {
    return getImageUrl(model.images[0].imagePath);
  }
  if (!model.thumbnailPath) return "";
  if (model.thumbnailPath.startsWith("http")) return model.thumbnailPath;
  return `/uploads/${model.thumbnailPath}`;
}

export function getModelFileUrl(model: Model3D): string | null {
  if (!model.filePath) return null;
  if (model.filePath.startsWith("http")) return model.filePath;
  return `/uploads/${model.filePath}`;
}

// ===== AUTH REQUIRED endpoints =====

// ===== IMPORT SESSION (used by MakerWorld import) =====

export interface ImportFile {
  name: string;
  relativePath: string;
  role: "stl" | "obj" | "glb" | "gltf" | "mtl" | "texture" | "source-image" | "archive" | "document" | "other";
}

export interface ImportSession {
  sessionId: string;
  detectedType: string;
  files: ImportFile[];
  expiresAt: string;
}

export async function createImportSession(url: string, sourceImages?: string[]): Promise<ImportSession> {
  const res = await authFetch(`${BASE}/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, sourceImages: sourceImages ?? [] }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const code = body?.error as string | undefined;
    const messages: Record<string, string> = {
      invalid_url: "The URL is not valid.",
      domain_not_allowed: "That domain is not in the allowed list.",
      url_fetch_failed: "Could not download the file. The URL may have expired.",
      unsupported_format: "Unsupported file format.",
      no_model_in_archive: "No supported 3D model found inside the archive.",
      invalid_archive: "The archive contains unsafe file paths.",
      file_too_large: "The file exceeds the 200 MB download limit.",
      extracted_size_exceeded: "The extracted archive exceeds the 400 MB size limit.",
    };
    throw new Error(code ? (messages[code] ?? `Import failed (${code}).`) : "Import failed.");
  }
  return res.json();
}

export async function getImportSession(sessionId: string): Promise<ImportSession> {
  const res = await authFetch(`${BASE}/import/session/${sessionId}`);
  if (!res.ok) throw new Error(`Session not found or expired (${res.status})`);
  return res.json();
}

export async function fetchImportSessionFile(sessionId: string, relativePath: string): Promise<Blob> {
  const res = await authFetch(`${BASE}/import/session/${sessionId}/file/${relativePath}`);
  if (!res.ok) throw new Error(`Failed to fetch session file: ${relativePath}`);
  return res.blob();
}

export async function deleteImportSession(sessionId: string): Promise<void> {
  await authFetch(`${BASE}/import/session/${sessionId}`, { method: "DELETE" });
}

export async function saveImportPackage(formData: FormData): Promise<{ id: number }> {
  const res = await authFetch(`${BASE}/import/package`, { method: "POST", body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? body?.detail ?? "Failed to save package.");
  }
  return res.json();
}

export async function createModel(formData: FormData): Promise<{ id: number }> {
  const res = await authFetch(`${BASE}/models`, { method: "POST", body: formData });
  if (!res.ok) throw new Error("Failed to create model");
  return res.json();
}

export async function updateModel(
  id: number,
  data: { title: string; description: string; category: string; tags: string }
) {
  const res = await authFetch(`${BASE}/models/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update model");
}

export async function deleteModel(id: number) {
  const res = await authFetch(`${BASE}/models/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete model");
}

export async function downloadModel(id: number): Promise<Blob> {
  const res = await authFetch(`${BASE}/models/${id}/download`);
  if (!res.ok) throw new Error("Failed to download model");
  return res.blob();
}

export async function fetchModelFiles(id: number): Promise<ModelFileEntry[]> {
  const res = await authFetch(`${BASE}/models/${id}/files`);
  if (!res.ok) return [];
  return res.json();
}

export async function downloadModelFile(id: number, path: string): Promise<Blob> {
  const res = await authFetch(`${BASE}/models/${id}/files/${path}`);
  if (!res.ok) throw new Error("Failed to download file");
  return res.blob();
}

// ===== USER / ROLE endpoints =====

export async function fetchCurrentUser(): Promise<UserInfo> {
  const res = await authFetch(`${BASE}/users/me`);
  if (!res.ok) throw new Error("Failed to fetch user info");
  return res.json();
}

export async function updateUserProfile(displayName: string): Promise<void> {
  const res = await authFetch(`${BASE}/users/me`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new Error("Failed to update profile");
}

export async function uploadUserAvatar(file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await authFetch(`${BASE}/users/me/avatar`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Failed to upload avatar");
  return res.json();
}

// ===== ADMIN endpoints =====

export async function fetchAdminStats(): Promise<AdminStats> {
  const res = await authFetch(`${BASE}/admin/stats`);
  if (!res.ok) throw new Error("Failed to fetch admin stats");
  return res.json();
}

export async function fetchAdminUsers(): Promise<UserInfo[]> {
  const res = await authFetch(`${BASE}/admin/users`);
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

export async function updateUserRole(userId: number, role: number): Promise<void> {
  const res = await authFetch(`${BASE}/admin/users/${userId}/role`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error("Failed to update user role");
}

export async function fetchAdminModels(search?: string): Promise<Model3D[]> {
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  const res = await authFetch(`${BASE}/admin/models?${query}`);
  if (!res.ok) throw new Error("Failed to fetch admin models");
  return res.json();
}

export async function adminDeleteModel(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/admin/models/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete model");
}

export async function uploadModelImages(
  modelId: number,
  cover: Blob,
  gallery: Blob[]
): Promise<void> {
  const formData = new FormData();
  formData.append("cover", cover, "cover.webp");
  gallery.forEach((blob, i) =>
    formData.append(`gallery${i}`, blob, `angle-${i + 1}.webp`)
  );
  const res = await authFetch(`${BASE}/models/${modelId}/images`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Failed to upload images for model ${modelId}`);
}
