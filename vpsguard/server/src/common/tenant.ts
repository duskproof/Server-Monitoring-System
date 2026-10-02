import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedUser } from '../common/decorators';

/** Requires a cabinet-scoped user and returns the organization id. */
export function requireOrganizationId(user: AuthenticatedUser | undefined): string {
  if (!user?.organizationId) {
    throw new UnauthorizedException('Cabinet context missing');
  }
  return user.organizationId;
}

export function assertSameOrganization(
  resourceOrgId: string | null | undefined,
  userOrgId: string,
  message = 'Resource not found',
): void {
  if (!resourceOrgId || resourceOrgId !== userOrgId) {
    // Hide existence of foreign-tenant resources.
    throw new ForbiddenException(message);
  }
}
