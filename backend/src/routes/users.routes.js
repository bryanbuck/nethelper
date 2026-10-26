/**
 * User administration (admin only). Creating a user is POST /auth/register;
 * this covers the rest of the lifecycle.
 *
 * Guard rails: an admin can't demote or delete themselves. Since only admins
 * reach these routes, that alone guarantees at least one admin remains.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param, validationResult } = require('express-validator');
const { getPrisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { deleteUserPreservingData } = require('../services/user-lifecycle');
const logger = require('../utils/logger');
const { endSocketSessions } = require('../websocket/socket.handler');

const router = express.Router();
router.use(authenticate, authorize('admin'));

const ROLES = ['admin', 'operator', 'viewer'];
const PUBLIC_FIELDS = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  lastLogin: true,
};

const idParam = param('id').isUUID().withMessage('Invalid user ID');

function rejectInvalid(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ success: false, errors: errors.array() });
  return true;
}

async function findUser(prisma, id, res) {
  const user = await prisma.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
  if (!user) res.status(404).json({ success: false, error: 'User not found' });
  return user;
}

router.get('/', async (req, res, next) => {
  try {
    const users = await getPrisma().user.findMany({ select: PUBLIC_FIELDS, orderBy: { createdAt: 'asc' } });
    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', [
  idParam,
  body('name').optional().trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('role').optional().isIn(ROLES).withMessage('Invalid role'),
], async (req, res, next) => {
  try {
    if (rejectInvalid(req, res)) return;
    const prisma = getPrisma();
    const user = await findUser(prisma, req.params.id, res);
    if (!user) return;

    const { name, role } = req.body;
    if (role && role !== user.role && user.id === req.user.id) {
      return res.status(400).json({ success: false, error: 'You cannot change your own role' });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { ...(name && { name }), ...(role && { role }) },
      select: PUBLIC_FIELDS,
    });
    logger.info('User updated by admin', { userId: user.id, role: updated.role, updatedBy: req.user.id });
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

// Set a new password for someone else (e.g. they forgot theirs). Signs them
// out everywhere at once: the stored refresh token is revoked and the
// tokenVersion bump rejects their access tokens and drops their sockets.
router.post('/:id/reset-password', [
  idParam,
  body('password').isLength({ min: 12 }).withMessage('Password must be at least 12 characters'),
], async (req, res, next) => {
  try {
    if (rejectInvalid(req, res)) return;
    const prisma = getPrisma();
    const user = await findUser(prisma, req.params.id, res);
    if (!user) return;

    const { tokenVersion } = await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(req.body.password, 12), refreshToken: null, tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    endSocketSessions(user.id, tokenVersion);
    logger.info('Password reset by admin', { userId: user.id, resetBy: req.user.id });
    res.json({ success: true, message: 'Password reset' });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', [idParam], async (req, res, next) => {
  try {
    if (rejectInvalid(req, res)) return;
    const prisma = getPrisma();
    const user = await findUser(prisma, req.params.id, res);
    if (!user) return;

    if (user.id === req.user.id) {
      return res.status(400).json({ success: false, error: 'You cannot delete your own account' });
    }

    // Shared records the user created (integrations, credentials, ...) move to
    // the admin doing the delete instead of being cascaded away.
    const reassigned = await deleteUserPreservingData(prisma, user.id, req.user.id);
    logger.info('User deleted by admin', { userId: user.id, email: user.email, deletedBy: req.user.id, reassigned });
    res.json({ success: true, message: 'User deleted', data: { reassigned } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
