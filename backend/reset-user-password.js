#!/usr/bin/env node
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

async function resetPassword() {
  const prisma = new PrismaClient();
  
  try {
    const email = 'test@test.com';
    const newPassword = 'test123';
    
    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    
    // Update the user
    const user = await prisma.user.update({
      where: { email },
      data: { password: hashedPassword },
      select: { id: true, email: true, name: true }
    });
    
    console.log(`Password reset successful for user: ${user.email} (${user.name})`);
    console.log(`New password: ${newPassword}`);
    console.log(`You can now login with email: ${email} and password: ${newPassword}`);
  } catch (error) {
    console.error('Error resetting password:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

resetPassword();