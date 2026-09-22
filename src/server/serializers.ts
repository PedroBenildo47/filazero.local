/**
 * Response serializers.
 *
 * Prisma returns full rows (including `passwordHash`). Nothing leaves the API
 * without passing through a serializer, so sensitive columns can never leak.
 */
import type {
  Notification,
  Organization,
  OrganizationMember,
  Ticket,
  User,
} from "@prisma/client";

export function publicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export function publicMember(member: OrganizationMember) {
  return {
    id: member.id,
    userId: member.userId,
    organizationId: member.organizationId,
    branchId: member.branchId,
    role: member.role,
    status: member.status,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

export function publicOrganization(
  organization: Organization & { branches?: unknown; queues?: unknown },
) {
  return {
    id: organization.id,
    name: organization.name,
    description: organization.description,
    category: organization.category,
    address: organization.address,
    city: organization.city,
    country: organization.country,
    phone: organization.phone,
    email: organization.email,
    status: organization.status,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    ...(organization.branches === undefined
      ? {}
      : { branches: organization.branches }),
    ...(organization.queues === undefined ? {} : { queues: organization.queues }),
  };
}

export function publicTicket(ticket: Ticket) {
  return {
    id: ticket.id,
    queueId: ticket.queueId,
    userId: ticket.userId,
    ticketNumber: ticket.ticketNumber,
    status: ticket.status,
    position: ticket.position,
    joinedAt: ticket.joinedAt,
    calledAt: ticket.calledAt,
    servingAt: ticket.servingAt,
    completedAt: ticket.completedAt,
    cancelledAt: ticket.cancelledAt,
  };
}

export function publicNotification(notification: Notification) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    read: notification.read,
    ticketId: notification.ticketId,
    createdAt: notification.createdAt,
  };
}
