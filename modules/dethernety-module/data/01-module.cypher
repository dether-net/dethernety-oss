MERGE (m:DTModule {name: 'dethernety'})
SET m.description = 'Built-in classes for Dethernety',
    m.version = '1.0.0',
    m.author = 'Dethernety Team',
    m.icon = 'system',
    m.updatedAt = datetime();
