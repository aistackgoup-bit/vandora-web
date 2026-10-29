import { supabase } from "./supabase";

// R2 credentials never reach the browser: /api/storage checks that the user is staff,
// then hands back a short-lived presigned URL that the file is PUT to directly.
const callStorageApi = async (payload: Record<string, unknown>) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Debes iniciar sesión para gestionar archivos");

  const res = await fetch("/api/storage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Storage request failed (${res.status})`);
  return data;
};

export const r2Storage = {
  uploadFile: async (file: File, path: string = "", customName?: string) => {
    try {
      const { uploadUrl, url, path: key } = await callStorageApi({
        action: "upload",
        fileName: file.name,
        contentType: file.type,
        folder: path,
        customName,
      });

      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);

      return { url: url as string, path: key as string, error: null };
    } catch (error: any) {
      console.error("Error uploading to R2:", error);
      return { url: null, path: null, error };
    }
  },

  deleteFile: async (path: string) => {
    try {
      await callStorageApi({ action: "delete", path });
      return { error: null };
    } catch (error: any) {
      console.error("Error deleting from R2:", error);
      return { error };
    }
  }
};
