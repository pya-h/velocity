import { Controller, Post as HttpPost, Upload, Guards } from '@velocity/framework';
import type { VelocityRequest, VelocityResponse, GuardFunction, UploadedFile } from '@velocity/framework';
import { velo } from '../../velo';

const authGuard: GuardFunction = (req) => !!req.headers['authorization'];

@Controller('/uploads')
class UploadController {
  @HttpPost('/avatar')
  @Guards(authGuard)
  @Upload({ maxSize: 5 * 1024 * 1024, maxFiles: 1 })
  async avatar(req: VelocityRequest, res: VelocityResponse) {
    const file = req.files?.avatar as UploadedFile | undefined;
    if (!file) return res.status(400).json({ error: 'No file uploaded (field: avatar)' });

    return res.status(200).json({
      uploaded: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });
  }

  @HttpPost('/documents')
  @Guards(authGuard)
  @Upload({ maxSize: 10 * 1024 * 1024, maxFiles: 5 })
  async documents(req: VelocityRequest, res: VelocityResponse) {
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const summary = Object.entries(req.files).map(([field, f]) => {
      const files = Array.isArray(f) ? f : [f];
      return { field, count: files.length, totalSize: files.reduce((s, file) => s + file.size, 0) };
    });

    return res.status(200).json({ files: summary });
  }
}

velo.register(UploadController);
