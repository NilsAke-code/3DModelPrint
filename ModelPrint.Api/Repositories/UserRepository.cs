using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using ModelPrint.Api.Data;
using ModelPrint.Api.Models;

namespace ModelPrint.Api.Repositories;

public class UserRepository(ModelPrintDbContext db, IConfiguration config)
{
    private string AdminEmail => config["AdminSettings:Email"] ?? "";
    public Task<User?> GetByMicrosoftIdAsync(string microsoftId) =>
        db.Users.FirstOrDefaultAsync(u => u.MicrosoftId == microsoftId);

    public Task<User?> GetByEmailAsync(string email) =>
        db.Users.FirstOrDefaultAsync(u => u.Email == email);

    public async Task<User> GetOrCreateAsync(string microsoftId, string email, string displayName)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.MicrosoftId == microsoftId);
        if (user is not null)
        {
            user.DisplayName = displayName;
            user.LastLoginAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return user;
        }

        user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        if (user is not null)
        {
            user.MicrosoftId = microsoftId;
            user.DisplayName = displayName;
            user.LastLoginAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return user;
        }

        // Auto-promote to admin if email matches AdminSettings:Email in appsettings.json
        var role = (!string.IsNullOrEmpty(AdminEmail) &&
                    email.Equals(AdminEmail, StringComparison.OrdinalIgnoreCase)) ? 2 : 1;

        user = new User
        {
            Email = email, DisplayName = displayName, MicrosoftId = microsoftId,
            Role = role, CreatedAt = DateTime.UtcNow, LastLoginAt = DateTime.UtcNow
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    public Task<List<User>> GetAllAsync() =>
        db.Users.OrderByDescending(u => u.CreatedAt).ToListAsync();

    public async Task UpdateRoleAsync(int userId, int role) =>
        await db.Users.Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.Role, role));

    public async Task<AdminStats> GetStatsAsync()
    {
        var week = DateTime.UtcNow.AddDays(-7);
        var month = DateTime.UtcNow.AddDays(-30);
        return new AdminStats
        {
            TotalModels      = await db.Models.CountAsync(),
            TotalUsers       = await db.Users.CountAsync(),
            TotalDownloads   = await db.Models.SumAsync(m => m.Downloads),
            TotalLikes       = await db.Models.SumAsync(m => m.Likes),
            ModelsLast7Days  = await db.Models.CountAsync(m => m.CreatedAt >= week),
            ModelsLast30Days = await db.Models.CountAsync(m => m.CreatedAt >= month),
            UsersLast7Days   = await db.Users.CountAsync(u => u.CreatedAt >= week),
            UsersLast30Days  = await db.Users.CountAsync(u => u.CreatedAt >= month),
        };
    }
}
