using Microsoft.EntityFrameworkCore;
using ModelPrint.Api.Data;
using ModelPrint.Api.Models;

namespace ModelPrint.Api.Seed;

/// <summary>
/// Phase 1 seeder: creates DB records only. FilePath = "" signals that the
/// browser-side SeedModelBuilder (Phase 2) must generate geometry and images.
/// Models with FilePath == "" are excluded from the public gallery until Phase 2 completes.
/// </summary>
public class DatabaseSeeder(ModelPrintDbContext db)
{
    public async Task SeedAsync()
    {
        if (await db.Models.AnyAsync()) return;

        foreach (var seed in SeedData.GetModels())
        {
            var model = new Model3D
            {
                Title         = seed.Title,
                Description   = seed.Description,
                Category      = seed.Category,
                FilePath      = "",          // Phase 2 (browser) fills this in
                ThumbnailPath = "",
                AuthorId      = seed.AuthorId,
                AuthorName    = seed.AuthorName,
                Downloads     = seed.Downloads,
                Likes         = seed.Likes,
                CreatedAt     = seed.CreatedAt,
                UpdatedAt     = seed.CreatedAt,
                IsExploreModel = true,
            };
            db.Models.Add(model);
            await db.SaveChangesAsync();

            foreach (var tagName in seed.Tags)
            {
                var tag = await db.Tags.FirstOrDefaultAsync(t => t.Name == tagName);
                if (tag is null)
                {
                    tag = new Tag { Name = tagName };
                    db.Tags.Add(tag);
                    await db.SaveChangesAsync();
                }
                if (!await db.ModelTags.AnyAsync(mt => mt.ModelId == model.Id && mt.TagId == tag.Id))
                    db.ModelTags.Add(new ModelTag { ModelId = model.Id, TagId = tag.Id });
            }
            await db.SaveChangesAsync();
        }

        if (!await db.Users.AnyAsync(u => u.Role < 2))
            await SeedUsersAsync();
    }

    private async Task SeedUsersAsync()
    {
        var rnd = new Random();
        var mockUsers = new[]
        {
            new { Email = "emma.karlsson@outlook.com",   DisplayName = "Emma Karlsson",   Role = 1 },
            new { Email = "james.wilson@hotmail.com",    DisplayName = "James Wilson",    Role = 1 },
            new { Email = "sofia.andersson@gmail.com",   DisplayName = "Sofia Andersson", Role = 1 },
            new { Email = "david.chen@outlook.com",      DisplayName = "David Chen",      Role = 1 },
            new { Email = "lisa.johnson@gmail.com",      DisplayName = "Lisa Johnson",    Role = 1 },
            new { Email = "marcus.berg@hotmail.com",     DisplayName = "Marcus Berg",     Role = 0 },
            new { Email = "anna.pettersson@outlook.com", DisplayName = "Anna Pettersson", Role = 0 },
            new { Email = "tom.baker@gmail.com",         DisplayName = "Tom Baker",       Role = 1 },
        };

        foreach (var u in mockUsers)
        {
            if (!await db.Users.AnyAsync(x => x.Email == u.Email))
            {
                db.Users.Add(new User
                {
                    Email       = u.Email,
                    DisplayName = u.DisplayName,
                    MicrosoftId = "",
                    Role        = u.Role,
                    CreatedAt   = DateTime.UtcNow.AddDays(-rnd.Next(60)),
                    LastLoginAt = DateTime.UtcNow.AddDays(-rnd.Next(14))
                });
            }
        }
        await db.SaveChangesAsync();
    }
}
