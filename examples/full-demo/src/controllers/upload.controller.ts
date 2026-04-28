import { Controller, Post as HttpPost, Upload, Guards, Status, StatusCode } from '@velocity/framework';
import type { VelocityResponse, GuardFunction, UploadedFile } from '@velocity/framework';
import { velo } from '../../velo';

const authGuard: GuardFunction = (req) => !!req.headers['authorization'];

interface UploadResult {
  uploaded: string;
  mimetype: string;
  size: number;
}

@Controller('/uploads')
class UploadController {
  // ── `file` injection + @Status ────────────────────────────────────────────
  @HttpPost('/avatar')
  @Guards(authGuard)
  @Upload({ maxSize: 5 * 1024 * 1024, maxFiles: 1 })
  @Status(StatusCode.OK)
  async avatar(file: Record<string, UploadedFile | UploadedFile[]> | undefined, res: VelocityResponse): Promise<UploadResult | void> {
    const avatar = file?.avatar as UploadedFile | undefined;
    if (!avatar) return res.status(StatusCode.BadRequest).json({ error: 'No file uploaded (field: avatar)' });

    return { uploaded: avatar.originalname, mimetype: avatar.mimetype, size: avatar.size };
  }

  // ── `body` + `file` injection ─────────────────────────────────────────────
  @HttpPost('/documents')
  @Guards(authGuard)
  @Upload({ maxSize: 10 * 1024 * 1024, maxFiles: 5 })
  async documents(
    body: Record<string, unknown>,
    file: Record<string, UploadedFile | UploadedFile[]> | undefined,
    res: VelocityResponse,
  ): Promise<{ textFields: Record<string, unknown>; files: unknown[] } | void> {
    if (!file || Object.keys(file).length === 0) {
      return res.status(StatusCode.BadRequest).json({ error: 'No files uploaded' });
    }

    const summary = Object.entries(file).map(([field, f]) => {
      const files = Array.isArray(f) ? f : [f];
      return { field, count: files.length, totalSize: files.reduce((s, fl) => s + fl.size, 0) };
    });

    return { textFields: body, files: summary };
  }
}

velo.register(UploadController);
