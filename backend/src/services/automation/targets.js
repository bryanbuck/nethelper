/**
 * Which devices a Manual or Schedule run covers: the devices given with the
 * request (Run Now from a device), else the trigger's own devices and device
 * groups, else the automation's device groups (older automations). An empty
 * list means one run with no device.
 */

const { getPrisma } = require('../../config/database');

async function resolveTargets(automation, triggerConfig = {}, explicitIds = []) {
  const prisma = getPrisma();
  let devices;
  if (explicitIds.length) {
    devices = await prisma.device.findMany({ where: { id: { in: explicitIds } } });
  } else if (triggerConfig.deviceIds?.length || triggerConfig.deviceGroupIds?.length) {
    const or = [];
    if (triggerConfig.deviceIds?.length) or.push({ id: { in: triggerConfig.deviceIds } });
    if (triggerConfig.deviceGroupIds?.length) or.push({ deviceGroups: { some: { id: { in: triggerConfig.deviceGroupIds } } } });
    devices = await prisma.device.findMany({ where: { OR: or } });
  } else {
    const groups = await prisma.deviceGroup.findMany({
      where: { automations: { some: { id: automation.id } } },
      include: { devices: true },
    });
    devices = groups.flatMap((g) => g.devices);
  }
  return [...new Map(devices.map((d) => [d.id, d])).values()];
}

module.exports = { resolveTargets };
