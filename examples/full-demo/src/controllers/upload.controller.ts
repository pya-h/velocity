import { Controller, Post as HttpPost, Upload, Guards, Status, StatusCode } from '@velocity/framework';
import type { VelocityResponse, UploadedFile } from '@velocity/framework';
import { velo } from '../../velo';
import { authGuard, type SessionUser } from '../guards/auth.guard';

interface UploadResult {
  uploaded: string;
  mimetype: string;
  size: number;
  uploadedBy: string;
}

@Controller('/uploads')
class UploadController {
  // ── Upload avatar (cookie auth) — `user` injected from guard ───────────────
  @HttpPost('/avatar')
  @Guards(authGuard)
  @Upload({ maxSize: 5 * 1024 * 1024, maxFiles: 1 })
  @Status(StatusCode.OK)
  async avatar(
    file: Record<string, UploadedFile | UploadedFile[]> | undefined,
    user: SessionUser,
    res: VelocityResponse,
  ): Promise<UploadResult | void> {
    const avatar = file?.avatar as UploadedFile | undefined;
    if (!avatar) return res.status(StatusCode.BadRequest).json({ error: 'No file uploaded (field: avatar)' });

    return {
      uploaded: avatar.originalname,
      mimetype: avatar.mimetype,
      size: avatar.size,
      uploadedBy: user.username,
    };
  }

  // ── Upload documents (cookie auth) ─────────────────────────────────────────
  @HttpPost('/documents')
  @Guards(authGuard)
  @Upload({ maxSize: 10 * 1024 * 1024, maxFiles: 5 })
  async documents(
    body: Record<string, unknown>,
    file: Record<string, UploadedFile | UploadedFile[]> | undefined,
    user: SessionUser,
    res: VelocityResponse,
  ): Promise<{ uploadedBy: string; textFields: Record<string, unknown>; files: unknown[] } | void> {
    if (!file || Object.keys(file).length === 0) {
      return res.status(StatusCode.BadRequest).json({ error: 'No files uploaded' });
    }

    const summary = Object.entries(file).map(([field, f]) => {
      const files = Array.isArray(f) ? f : [f];
      return { field, count: files.length, totalSize: files.reduce((s, fl) => s + fl.size, 0) };
    });

    return { uploadedBy: user.username, textFields: body, files: summary };
  }
}

velo.register(UploadController);
