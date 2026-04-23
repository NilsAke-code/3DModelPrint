using Microsoft.EntityFrameworkCore;
using ModelPrint.Api.Models;

namespace ModelPrint.Api.Data;

public class ModelPrintDbContext(DbContextOptions<ModelPrintDbContext> options) : DbContext(options)
{
    public DbSet<Model3D> Models => Set<Model3D>();
    public DbSet<ModelImage> ModelImages => Set<ModelImage>();
    public DbSet<ModelPart> ModelParts => Set<ModelPart>();
    public DbSet<Tag> Tags => Set<Tag>();
    public DbSet<ModelTag> ModelTags => Set<ModelTag>();
    public DbSet<User> Users => Set<User>();
    public DbSet<DownloadHistory> DownloadHistories => Set<DownloadHistory>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<ModelTag>().HasKey(mt => new { mt.ModelId, mt.TagId });
        b.Entity<ModelTag>()
            .HasOne(mt => mt.Model)
            .WithMany(m => m.ModelTags)
            .HasForeignKey(mt => mt.ModelId)
            .OnDelete(DeleteBehavior.Cascade);
        b.Entity<ModelTag>()
            .HasOne(mt => mt.TagEntity)
            .WithMany(t => t.ModelTags)
            .HasForeignKey(mt => mt.TagId)
            .OnDelete(DeleteBehavior.Cascade);

        b.Entity<ModelImage>()
            .HasOne(i => i.Model)
            .WithMany(m => m.Images)
            .HasForeignKey(i => i.ModelId)
            .OnDelete(DeleteBehavior.Cascade);

        b.Entity<ModelPart>()
            .HasOne(p => p.Model)
            .WithMany(m => m.Parts)
            .HasForeignKey(p => p.ModelId)
            .OnDelete(DeleteBehavior.Cascade);

        b.Entity<Model3D>().Property(m => m.Title).HasMaxLength(200).IsRequired();
        b.Entity<Model3D>().Property(m => m.Category).HasMaxLength(100);
        b.Entity<Model3D>().Property(m => m.AuthorId).HasMaxLength(200);

        b.Entity<User>().HasIndex(u => u.Email).IsUnique();
        b.Entity<User>().Property(u => u.Email).HasMaxLength(320).IsRequired();
        b.Entity<User>().Property(u => u.MicrosoftId).HasMaxLength(200);

        b.Entity<Tag>().HasIndex(t => t.Name).IsUnique();
        b.Entity<Tag>().Property(t => t.Name).HasMaxLength(100).IsRequired();

        b.Entity<DownloadHistory>()
            .HasOne(d => d.Model)
            .WithMany()
            .HasForeignKey(d => d.ModelId)
            .OnDelete(DeleteBehavior.Cascade);
        b.Entity<DownloadHistory>()
            .HasOne(d => d.UserNav)
            .WithMany(u => u.DownloadHistories)
            .HasForeignKey(d => d.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
