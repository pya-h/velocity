import {
  Controller, Get, Post,
  Guards,
  Status, StatusCode,
  Validate, Validator,
  VeloSession,
} from '@velocity/framework';
import type { VeloResponse } from '@velocity/framework';
import { velo } from '../../velo';
import { authGuard, type SessionUser } from '../guards/auth.guard';
import * as Joi from 'joi';

const loginSchema = Validator.createSchema({
  username: Joi.string().required(),
  password: Joi.string().min(4).required(),
});

// Hardcoded users for demo — in production this would hit a database
const DEMO_USERS: Record<string, { password: string; role: string }> = {
  admin: { password: 'admin123', role: 'admin' },
  user:  { password: 'user1234', role: 'user' },
};

@Controller('/auth')
class AuthController {
  /**
   * POST /api/auth/login
   * Validates credentials, stores user data in an encrypted session cookie.
   *
   * The session cookie is AES-256-GCM encrypted + HMAC-SHA256 signed.
   * The client cannot read or tamper with it.
   */
  @Post('/login')
  @Validate(loginSchema)
  @Status(StatusCode.OK)
  login(
    body: { username: string; password: string },
    session: VeloSession<SessionUser>,
    res: VeloResponse,
  ): { message: string; user: string; role: string } | void {
    const entry = DEMO_USERS[body.username];
    if (!entry || entry.password !== body.password) {
      res.status(StatusCode.Unauthorized).json({ error: 'Invalid credentials' });
      return;
    }

    // Store user data in encrypted session — one call, framework handles everything
    session.set({ username: body.username, role: entry.role });

    return { message: 'Logged in', user: body.username, role: entry.role };
  }

  /**
   * POST /api/auth/logout
   * Destroys the session cookie.
   */
  @Post('/logout')
  @Status(StatusCode.OK)
  logout(session: VeloSession): { message: string } {
    session.destroy();
    return { message: 'Logged out' };
  }

  /**
   * GET /api/auth/me
   * Returns the current user from the encrypted session.
   *
   * The authGuard verifies the session and populates req.user.
   * The `user` param injects the authenticated SessionUser.
   */
  @Get('/me')
  @Guards(authGuard)
  me(user: SessionUser): { user: string; role: string } {
    return { user: user.username, role: user.role };
  }
}

velo.register(AuthController);
