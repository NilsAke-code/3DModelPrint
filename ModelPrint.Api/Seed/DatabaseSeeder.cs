using Microsoft.EntityFrameworkCore;
using ModelPrint.Api.Data;

namespace ModelPrint.Api.Seed;

public class DatabaseSeeder(ModelPrintDbContext db)
{
    public async Task SeedAsync()
    {
        await db.Database.MigrateAsync();
    }
}
