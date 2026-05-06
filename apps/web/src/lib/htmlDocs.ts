export interface HtmlDocMeta {
  id: string;
  template: string;
  templateLabel: string;
  topic: string;
  status: 'draft' | 'done';
  createdAt: number;
  updatedAt: number;
}

export interface HtmlDoc extends HtmlDocMeta {
  html: string;
}

const API_BASE =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001')
    : 'http://localhost:8001';

export async function listDocs(): Promise<HtmlDocMeta[]> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/html-docs`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function loadDoc(id: string): Promise<HtmlDoc | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/html-docs/${id}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function saveDoc(doc: HtmlDoc): Promise<HtmlDoc> {
  const res = await fetch(`${API_BASE}/api/v1/html-docs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new Error('저장 실패');
  return res.json();
}

export async function createDoc(
  template: string,
  templateLabel: string,
  topic: string,
  html: string,
): Promise<HtmlDoc> {
  const now = Date.now();
  return saveDoc({
    id: crypto.randomUUID(),
    template,
    templateLabel,
    topic,
    html,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  });
}

export async function deleteDoc(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/v1/html-docs/${id}`, { method: 'DELETE' });
}
