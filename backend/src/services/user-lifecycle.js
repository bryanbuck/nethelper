/**
 * Deleting a user safely.
 *
 * Several shared records carry a required `createdBy` relation to User, and
 * the schema cascades deletes on most of them: removing the account of
 * whoever set up a cloud integration or a credential would silently delete the
 * integration or credential too (and a user who created an Automation can't
 * be deleted at all, the FK restricts it). These records belong to the
 * instance, not the person, so ownership is handed to another admin first,
 * in the same transaction as the delete.
 *
 * Takes the Prisma client as a parameter so the CLI (scripts/user-manager.js),
 * which has its own client, can use it too.
 */

// Models whose userId is a required "created by" relation to User.
const OWNED_MODELS = ['apiCredential', 'cloudIntegration', 'gitBackupConfig', 'arubaCentralConfig', 'automation', 'notificationChannel'];

/**
 * @param {PrismaClient} prisma
 * @param {string} userId - account to delete
 * @param {string} newOwnerId - admin who takes over the user's shared records
 * @returns {Promise<Object>} counts of reassigned rows per model
 */
async function deleteUserPreservingData(prisma, userId, newOwnerId) {
  if (!newOwnerId || newOwnerId === userId) {
    throw new Error('A different user must take over the deleted user\'s records');
  }
  return prisma.$transaction(async (tx) => {
    const reassigned = {};
    for (const model of OWNED_MODELS) {
      const { count } = await tx[model].updateMany({ where: { userId }, data: { userId: newOwnerId } });
      if (count) reassigned[model] = count;
    }
    // Execution.triggeredBy is optional; Prisma nulls it on delete.
    await tx.user.delete({ where: { id: userId } });
    return reassigned;
  });
}

module.exports = { deleteUserPreservingData, OWNED_MODELS };
