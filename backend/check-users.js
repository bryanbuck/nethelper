#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');

async function checkUsers() {
  const prisma = new PrismaClient();
  
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        lastLogin: true
      }
    });
    
    console.log(`Found ${users.length} users in the database:`);
    
    if (users.length === 0) {
      console.log('No users found. You need to create a user account first.');
      console.log('Run: node scripts/user-manager.js');
    } else {
      users.forEach(user => {
        console.log(`- ${user.email} (${user.name}) - Role: ${user.role} - Created: ${user.createdAt} - Last Login: ${user.lastLogin || 'Never'}`);
      });
    }
  } catch (error) {
    console.error('Database error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();