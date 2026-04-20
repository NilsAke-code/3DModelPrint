import { apiRequest } from "../auth/authConfig";
import { msalInstance } from "../auth/AuthProvider";
import type { Model3D, Tag, UserInfo, AdminStats } from "../types";

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

export async function likeModel(id: number) {
  await fetch(`${BASE}/models/${id}/like`, { method: "POST" });
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

// ===== USER / ROLE endpoints =====

export async function fetchCurrentUser(): Promise<UserInfo> {
  const res = await authFetch(`${BASE}/users/me`);
  if (!res.ok) throw new Error("Failed to fetch user info");
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

export async function uploadSeedModelImages(
  modelId: number,
  cover: Blob,
  gallery: Blob[]
): Promise<void> {
  const formData = new FormData();
  formData.append("cover", cover, "cover.webp");
  gallery.forEach((blob, i) =>
    formData.append(`gallery${i}`, blob, `angle-${i + 1}.webp`)
  );
  const res = await fetch(`${BASE}/models/${modelId}/seed-images`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Failed to upload seed images for model ${modelId}`);
}

/** Upload the browser-generated STL for a seed model and patch FilePath on the server. */
export async function uploadSeedFile(modelId: number, stlBlob: Blob): Promise<void> {
  const formData = new FormData();
  formData.append('file', stlBlob, 'model.stl');
  const res = await fetch(`${BASE}/models/${modelId}/seed-file`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Failed to upload seed file for model ${modelId}`);
}

/** Delete an incomplete seed record (FilePath == ""). Safe to call without auth. */
export async function fetchPendingSeeds(): Promise<Model3D[]> {
  const res = await fetch(`${BASE}/models/pending-seeds`);
  if (!res.ok) throw new Error('Failed to fetch pending seed models');
  return res.json();
}

export async function seedCleanup(modelId: number): Promise<void> {
  const res = await fetch(`${BASE}/models/${modelId}/seed-cleanup`, { method: 'DELETE' });
  // 404 = already gone; Conflict = already completed — both are acceptable, not errors
  if (!res.ok && res.status !== 404 && res.status !== 409) {
    throw new Error(`seed-cleanup failed for model ${modelId}: ${res.status}`);
  }
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
