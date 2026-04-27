import { Controller, Post as HttpPost, Upload, Guards } from '@velocity/framework';
import type { VelocityResponse, GuardFunction, UploadedFile } from '@velocity/framework';
import { velo } from '../../velo';

const authGuard: GuardFunction = (req) => !!req.headers['authorization'];

@Controller('/uploads')
class UploadController {
  // ── Injection style: `file` + `res` ───────────────────────────────────────
  // `file` injects req.files — the parsed multipart files.
  @HttpPost('/avatar')
  @Guards(authGuard)
  @Upload({ maxSize: 5 * 1024 * 1024, maxFiles: 1 })
  async avatar(file: Record<string, UploadedFile | UploadedFile[]> | undefined, res: VelocityResponse) {
    const avatar = file?.avatar as UploadedFile | undefined;
    if (!avatar) return res.status(400).json({ error: 'No file uploaded (field: avatar)' });

    return { uploaded: avatar.originalname, mimetype: avatar.mimetype, size: avatar.size };
  }

  // ── Injection style: `body` + `file` ──────────────────────────────────────
  // Multipart: text fields in `body`, files in `file`.
  @HttpPost('/documents')
  @Guards(authGuard)
  @Upload({ maxSize: 10 * 1024 * 1024, maxFiles: 5 })
  async documents(body: any, file: Record<string, UploadedFile | UploadedFile[]> | undefined, res: VelocityResponse) {
    if (!file || Object.keys(file).length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const summary = Object.entries(file).map(([field, f]) => {
      const files = Array.isArray(f) ? f : [f];
      return { field, count: files.length, totalSize: files.reduce((s, fl) => s + fl.size, 0) };
    });

    return { textFields: body, files: summary };
  }
}

velo.register(UploadController);
