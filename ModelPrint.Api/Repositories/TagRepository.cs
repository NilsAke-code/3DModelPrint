using Microsoft.EntityFrameworkCore;
using ModelPrint.Api.Data;
using ModelPrint.Api.Models;

namespace ModelPrint.Api.Repositories;

public class TagRepository(ModelPrintDbContext db)
{
    public Task<List<Tag>> GetAllAsync() =>
        db.Tags.OrderBy(t => t.Name).ToListAsync();
}
