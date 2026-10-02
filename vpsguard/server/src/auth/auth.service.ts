import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { User, UserRole } from '../database/entities';
import { OrganizationsService } from '../organizations/organizations.service';
import { LoginDto, RegisterDto } from './dto';

const BCRYPT_ROUNDS = 12;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: UserRole;
    organizationId: string;
  };
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly organizations: OrganizationsService,
    private readonly alerts: AlertsService,
  ) {}

  /** Bootstraps a default admin + cabinet so a fresh deployment is immediately usable. */
  async onModuleInit(): Promise<void> {
    const count = await this.users.count();
    if (count > 0) return;

    const email = process.env.ADMIN_EMAIL ?? 'admin@vpsguard.local';
    const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
    const org = await this.organizations.createCabinet('Platform cabinet', email);
    await this.users.save(
      this.users.create({
        email,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        name: 'Administrator',
        role: UserRole.ADMIN,
        organizationId: org.id,
      }),
    );
    await this.alerts.seedDefaultRules(org.id);
    this.logger.warn(`Bootstrapped default admin "${email}" in cabinet ${org.id}. Change the password now.`);
  }

  async register(dto: RegisterDto): Promise<TokenPair> {
    const existing = await this.users.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('Email is already registered');

    const allowPublic =
      (process.env.ALLOW_PUBLIC_REGISTRATION ?? 'true').toLowerCase() !== 'false';
    if (!allowPublic && (await this.users.count()) > 0) {
      throw new ForbiddenException(
        'Public registration is disabled. Ask a cabinet admin to create your account.',
      );
    }

    const cabinetName = (dto.name?.trim() || dto.email.split('@')[0] || 'Cabinet').slice(0, 160);
    const org = await this.organizations.createCabinet(`${cabinetName} cabinet`, dto.email);
    const user = await this.users.save(
      this.users.create({
        email: dto.email.toLowerCase(),
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
        name: dto.name ?? null,
        role: UserRole.ADMIN,
        organizationId: org.id,
      }),
    );
    await this.alerts.seedDefaultRules(org.id);
    return this.issueTokens(user);
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.users.findOne({ where: { email: dto.email.toLowerCase() } });
    if (!user || !user.isActive || !user.organizationId) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user?.refreshTokenHash || !user.organizationId) {
      throw new UnauthorizedException('Session revoked');
    }

    const matches = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!matches) throw new UnauthorizedException('Session revoked');

    return this.issueTokens(user);
  }

  async logout(userId: string): Promise<void> {
    await this.users.update({ id: userId }, { refreshTokenHash: null });
  }

  async me(userId: string) {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { organization: true },
    });
    if (!user) throw new UnauthorizedException();
    return this.toPublic(user);
  }

  async updateProfile(
    userId: string,
    dto: { name?: string; email?: string; password?: string; currentPassword?: string },
  ) {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { organization: true },
    });
    if (!user) throw new UnauthorizedException();

    if (dto.password) {
      if (!dto.currentPassword) throw new UnauthorizedException('Current password is required');
      const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!valid) throw new UnauthorizedException('Current password is incorrect');
      user.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
      user.refreshTokenHash = null;
    }

    if (dto.name !== undefined) user.name = dto.name;
    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const taken = await this.users.findOne({ where: { email: dto.email.toLowerCase() } });
      if (taken) throw new ConflictException('Email is already registered');
      user.email = dto.email.toLowerCase();
    }

    return this.toPublic(await this.users.save(user));
  }

  private toPublic(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name ?? '',
      role: user.role,
      organizationId: user.organizationId as string,
      organizationName: user.organization?.name ?? undefined,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private async issueTokens(user: User): Promise<TokenPair> {
    if (!user.organizationId) {
      throw new UnauthorizedException('User has no cabinet');
    }
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessTtl'),
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('jwt.refreshSecret'),
      expiresIn: this.config.get<string>('jwt.refreshTtl'),
    });

    await this.users.update(
      { id: user.id },
      { refreshTokenHash: await bcrypt.hash(refreshToken, BCRYPT_ROUNDS) },
    );

    const withOrg =
      user.organization != null
        ? user
        : ((await this.users.findOne({
            where: { id: user.id },
            relations: { organization: true },
          })) as User);

    return {
      accessToken,
      refreshToken,
      user: this.toPublic(withOrg),
    };
  }
}
