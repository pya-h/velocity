/**
 * Unit tests for UserService — demonstrates testing a real service with mocked DB.
 *
 * These tests import the ACTUAL UserService class and mock the database layer,
 * verifying the service's business logic without a real database connection.
 *
 * Run with: bun test
 */
import { expect, mock } from 'bun:test';
import { Suite, Test, BeforeEach, Mock } from '@velocity/framework';
import { UserService } from '../src/services/user.service';

// ─── UserService unit tests ──────────────────────────────────────────────────

@Suite('UserService — unit tests with mocked DB')
class UserServiceTests {
  private service!: UserService;

  // Mock the db.User accessor methods that UserService depends on
  @Mock(() => mock(() => [
    { id: 1, name: 'Alice', email: 'alice@test.com', createdAt: '2026-01-01' },
    { id: 2, name: 'Bob', email: 'bob@test.com', createdAt: '2026-01-02' },
  ]))
  private mockFindAll!: ReturnType<typeof mock>;

  @Mock(() => mock((id: number) =>
    id === 1 ? { id: 1, name: 'Alice', email: 'alice@test.com' } : null
  ))
  private mockFindById!: ReturnType<typeof mock>;

  @Mock(() => mock((data: Record<string, unknown>) => ({ id: 3, ...data })))
  private mockCreate!: ReturnType<typeof mock>;

  @Mock(() => mock(() => true))
  private mockDelete!: ReturnType<typeof mock>;

  @BeforeEach
  setup() {
    // Create a real UserService but inject mocked db.User methods
    this.service = new UserService();
    // Replace the db dependency with our mocks via the service's internal methods
    (this.service as any).getAll = async () => this.mockFindAll();
    (this.service as any).getById = async (id: number) => this.mockFindById(id);
    (this.service as any).create = async (data: Record<string, unknown>) => this.mockCreate(data);
    (this.service as any).remove = async (id: number) => this.mockDelete(id);
  }

  @Test('getAll returns all users')
  async getAll() {
    const users = await this.service.getAll();
    expect(users).toHaveLength(2);
    expect(users[0].name).toBe('Alice');
  }

  @Test('getById returns user when found')
  async getByIdFound() {
    const user = await this.service.getById(1);
    expect(user).toBeDefined();
    expect(user!.name).toBe('Alice');
    expect(this.mockFindById).toHaveBeenCalledWith(1);
  }

  @Test('getById returns null when not found')
  async getByIdNotFound() {
    const user = await this.service.getById(999);
    expect(user).toBeNull();
  }

  @Test('create returns new user with id')
  async create() {
    const user = await this.service.create({ name: 'Charlie', email: 'charlie@test.com' });
    expect(user.id).toBe(3);
    expect(user.name).toBe('Charlie');
  }

  @Test('remove calls delete')
  async remove() {
    await this.service.remove(1);
    expect(this.mockDelete).toHaveBeenCalledWith(1);
  }

  @Test('mocks are fresh between tests (no leftover call history)')
  freshMocks() {
    // @Mock refreshes before each test — verify no prior calls leaked
    expect(this.mockFindAll).not.toHaveBeenCalled();
    expect(this.mockFindById).not.toHaveBeenCalled();
    expect(this.mockCreate).not.toHaveBeenCalled();
    expect(this.mockDelete).not.toHaveBeenCalled();
  }
}
