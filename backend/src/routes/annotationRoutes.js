import { Router } from 'express';
import { authenticate, requireModule } from '../middlewares/auth.js';
import { asyncHandler } from '../utils/errors.js';
import { addReply, createAnnotation, deleteAnnotation, listAnnotations, setStatus } from '../services/annotationService.js';

// Website Annotation & Feedback. Open to roles with the `annotations` module
// (reviewer, admin and superadmin by default, widened in Pengaturan Akses);
// no one else can read a comment, let alone leave one.
const router = Router();
router.use(authenticate, requireModule('annotations'));

router.get('/', asyncHandler(async (req, res) => {
  res.json({ annotations: await listAnnotations() });
}));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json({ annotation: await createAnnotation(req.user, req.body || {}) });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  res.json({ annotation: await setStatus(req.user, req.params.id, req.body?.status) });
}));

router.post('/:id/replies', asyncHandler(async (req, res) => {
  res.status(201).json({ annotation: await addReply(req.user, req.params.id, req.body?.body) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await deleteAnnotation(req.user, req.params.id);
  res.json({ message: 'Anotasi dihapus' });
}));

export default router;
