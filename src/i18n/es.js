// Everything the app says, in Spanish. Same codes and same values as en.js, which is the reference.
//
// The Spanish is neutral on purpose: informal "tú", no regional forms, so it reads naturally
// anywhere Spanish is spoken. Words developers use in English every day (commit, push, remote
// as "remoto", worktree) stay close to how they are said at work.

export default {
  // Shared words
  'common.cancel': 'Cancelar',
  'common.close': 'Cerrar',
  'common.copy': 'Copiar',
  'common.copied': 'Copiado.',
  'common.done': 'Listo',

  // Top bar
  'toolbar.label': 'Ayuda y configuración',
  'toolbar.guide': 'Guía',
  'toolbar.guide.hint': 'Hacer el recorrido guiado',
  'toolbar.info': 'Info',
  'toolbar.info.hint': 'Versiones y dónde se guardan tus datos',
  'toolbar.settings': 'Configuración',
  'toolbar.settings.hint': 'Idioma y tema',
  'toolbar.refresh': 'Actualizar',
  'toolbar.refresh.hint': 'Volver a leer git',
  'environment.gitMissing': 'No se encontró Git',
  'environment.gcmMissing': 'No se encontró el administrador de credenciales',
  'environment.gcmMissing.hint': 'Para iniciar sesión desde la app se necesita Git Credential Manager.',

  // Accounts
  'accounts.title': 'Cuentas',
  'accounts.add': 'Agregar cuenta',
  'accounts.empty.title': 'Agrega tu primera cuenta',
  'accounts.empty.body': 'Una cuenta es el autor de los commits y el usuario de GitHub con el que haces push.',
  'account.signedIn': 'Sesión iniciada',
  'account.signIn': 'Iniciar sesión',
  'account.sshKey': 'Clave SSH',
  'account.folders.caption': 'Se usa en todo lo que hay dentro de',
  'account.owners.caption': 'Se usa en los repositorios de',
  'account.rules.caption': 'Usarla automáticamente en',
  'account.addFolder': 'Agregar carpeta',
  'account.addFolder.hint': 'Usar esta cuenta en todos los repositorios de una carpeta',
  'account.addOwner': 'Agregar propietario',
  'account.addOwner.hint': 'Usar esta cuenta en todos los repositorios de un usuario u organización de GitHub',
  'account.edit': 'Editar',
  'account.remove': 'Quitar',
  'rule.add': 'Agregar regla',
  'rule.remove': 'Quitar esta regla',
  'rule.remove.label': 'Quitar la regla de {subject}',
  'stray.title': 'Reglas sin cuenta',
  'stray.body': 'Git sigue aplicando estas reglas, pero su cuenta ya no está en la app.',
  'signIn.waiting': 'Termina de iniciar sesión en GitHub en la ventana de Git Credential Manager.',
  'signIn.done': 'Sesión iniciada como {user}.',
  'signIn.otherAccount':
    'El inicio de sesión terminó, pero "{user}" no tiene la sesión iniciada. Revisa qué cuenta de GitHub usó tu navegador.',
  'signIn.failed': 'El inicio de sesión no terminó.',
  'signIn.failedBecause': 'El inicio de sesión no terminó. {detail}',
  'account.missing': 'Esa cuenta ya no existe.',
  'account.inUse': {
    one: 'Esta cuenta está asignada a 1 proyecto. Primero pásalo a otra cuenta.',
    other: 'Esta cuenta está asignada a {count} proyectos. Primero pásalos a otra cuenta.',
  },
  'account.hasRules': {
    one: 'Esta cuenta todavía tiene 1 regla. Primero quítala.',
    other: 'Esta cuenta todavía tiene {count} reglas. Primero quítalas.',
  },

  // Account form
  'accountDialog.edit': 'Editar cuenta',
  'accountDialog.intro':
    'Una cuenta es la identidad con la que git hace commit y push. Las contraseñas y los tokens se quedan en tu administrador de credenciales.',
  'accountDialog.label': 'Etiqueta',
  'accountDialog.label.placeholder': 'Trabajo',
  'accountDialog.githubUser': 'Usuario de GitHub',
  'accountDialog.githubUser.hint': 'El usuario con el que haces push en github.com.',
  'accountDialog.gitName': 'Nombre en los commits',
  'accountDialog.gitEmail': 'Correo en los commits',
  'accountDialog.sshKey': 'Clave privada SSH (opcional)',
  'accountDialog.sshKey.placeholder': 'Ninguna clave seleccionada',
  'accountDialog.sshKey.choose': 'Elegir archivo',
  'accountDialog.sshKey.generate': 'Generar',
  'accountDialog.sshKey.clear': 'Quitar',
  'accountDialog.sshKey.hint': 'Solo hace falta para proyectos cuyo remoto usa SSH.',
  'accountDialog.publicKey': 'Clave pública',
  'accountDialog.publicKey.hint': 'Agrégala a esta cuenta en github.com, en Settings, SSH and GPG keys, New SSH key.',
  'accountDialog.publicKey.created': 'Clave creada sin frase de contraseña. Guarda la cuenta para empezar a usarla.',
  'accountDialog.save': 'Guardar cuenta',
  'field.controlCharacters': 'No puede contener saltos de línea ni otros caracteres de control.',
  'label.required': 'Escribe una etiqueta, como Trabajo o Personal.',
  'label.tooLong': 'Usa {max} caracteres o menos.',
  'label.taken': 'Otra cuenta ya usa esta etiqueta.',
  'gitName.required': 'Escribe el nombre que aparece en tus commits.',
  'gitName.tooLong': 'Usa {max} caracteres o menos.',
  'gitEmail.required': 'Escribe el correo que aparece en tus commits.',
  'gitEmail.invalid': 'Escribe una dirección de correo completa, como ada@example.com.',
  'githubUser.required': 'Escribe el usuario de GitHub con el que haces push.',
  'githubUser.invalid': 'Escribe solo el nombre de usuario: letras, números, guiones y guiones bajos, hasta 39 caracteres.',
  'sshKeyPath.publicKey': 'Esa es la clave pública. Elige la clave privada: el archivo sin .pub.',
  'sshKeyPath.missing': 'Ese archivo no existe. Vuelve a elegir la clave privada.',
  'sshKey.labelRequired': 'Primero escribe una etiqueta. El archivo de la clave lleva su nombre.',
  'sshKey.exists': 'Ya existe una clave llamada {name}. Selecciónala con "Elegir archivo".',
  'sshKey.keygenMissing': 'No se encontró ssh-keygen. Instala el cliente OpenSSH, o crea la clave por tu cuenta y elígela.',
  'sshKey.failed': 'No se pudo crear la clave. Comprueba que puedes escribir en la carpeta .ssh.',

  // Rules
  'ownerDialog.title': 'Agregar regla de propietario',
  'ownerDialog.intro':
    'Los repositorios cuyo remoto pertenece a este usuario u organización de github.com usan "{account}", estén donde estén en el disco y desde el momento en que los clonas.',
  'ownerDialog.owner': 'Usuario u organización de GitHub',
  'ownerDialog.owner.hint': 'También puedes pegar la URL de uno de sus repositorios.',
  'ownerDialog.note':
    'Esto agrega una regla a tu configuración global de git. Tu nombre y tu correo globales quedan como están, y un proyecto con su propia cuenta la conserva.',
  'owner.invalid': 'Escribe un usuario u organización de GitHub, como "acme", o pega la URL de un repositorio.',
  'owner.taken': '"{owner}" ya usa {account}. Primero quita esa regla.',
  'owner.takenByStray': '"{owner}" ya tiene una regla cuya cuenta ya no está en la app. Primero quita esa regla.',
  'folder.required': 'Primero elige una carpeta.',
  'folder.missing': '"{folder}" ya no existe.',
  'folder.pattern':
    'Git no puede apuntar exactamente a "{folder}" porque su ruta contiene *, ? o corchetes. Elige otra carpeta.',
  'folder.taken': '"{folder}" ya usa {account}. Primero quita esa regla.',
  'folder.takenByStray': '"{folder}" ya tiene una regla cuya cuenta ya no está en la app. Primero quita esa regla.',
  'confirm.addFolder.title': 'Agregar regla de carpeta',
  'confirm.addFolder.question': '¿Usar "{account}" en todo lo que hay dentro de {folder}?',
  'confirm.addFolder.detail':
    'Esto agrega una regla a tu configuración global de git. Carga los ajustes de esta cuenta en los repositorios de esa carpeta, incluidos los que clones más adelante. Tu nombre y tu correo globales quedan como están, y un proyecto con su propia cuenta la conserva.',
  'confirm.removeRule.title': 'Quitar regla',
  'confirm.removeFolder.question': '¿Quitar la regla de {folder}?',
  'confirm.removeFolder.detail':
    'Los repositorios que contiene vuelven a tu identidad global, salvo que se aplique otra regla o su propia cuenta.',
  'confirm.removeOwner.question': '¿Quitar la regla de los repositorios de {owner}?',
  'confirm.removeOwner.detail': 'Vuelven a tu identidad global, salvo que se aplique otra regla o su propia cuenta.',
  'confirm.removeAccount.title': 'Quitar cuenta',
  'confirm.removeAccount.question': '¿Quitar la cuenta "{account}" de la app?',
  'confirm.removeAccount.detail':
    'Su sesión sigue en tu administrador de credenciales y su clave SSH sigue en el disco. Solo la app olvida la cuenta.',

  // Projects
  'projects.title': 'Proyectos',
  'projects.add': 'Agregar proyecto',
  'projects.empty.title': 'Agrega un proyecto',
  'projects.empty.body':
    'Elige un repositorio para asignarle una cuenta. Para una carpeta en la que vas a clonar, usa "Agregar carpeta" en una cuenta.',
  'project.needsAttention': 'Requiere atención',
  'project.status.notRepository': 'No es un repositorio git',
  'project.remove': 'Quitar de la lista',
  'project.remove.label': 'Quitar {name} de la lista',
  'project.removed': 'Se quitó {name} de la lista. Su configuración de git quedó como estaba.',
  'project.reorder': 'Arrastra para reordenar, o usa las flechas arriba y abajo',
  'project.reorder.label': 'Reordenar {name}',
  'project.moved': '{name} pasó a la posición {position} de {total}.',
  'project.account.label': 'Cuenta de {name}',
  'project.account.unset': 'Sin asignar (usa la global)',
  'project.account.custom': 'Personalizada (definida a mano)',
  'project.account.drifted': 'Editada a mano (era {account})',
  'project.account.folderRule': 'Regla de carpeta ({account})',
  'project.account.ownerRule': 'Regla de propietario ({account})',
  'project.account.unknown': 'una cuenta',
  'project.notRepository':
    '"{name}" no es un repositorio git, así que no puede ser un proyecto. Para usar una cuenta en todo lo que clones dentro, elige "Agregar carpeta" en esa cuenta.',
  'project.alreadyListed': '"{name}" ya está en la lista.',
  'project.untracked': 'Ese proyecto ya no está en la lista.',
  'project.noLongerRepository': 'Esta carpeta ya no es un repositorio git.',

  // What git resolves in a project
  'detail.empty': 'Selecciona un proyecto para ver con qué identidad git hace commit y push en él.',
  'detail.notRepository': '"{name}" ya no es un repositorio git. Restaura la carpeta o quítala de la lista.',
  'detail.title': 'Lo que git resuelve en {name}',
  'detail.authorName': 'Nombre del autor',
  'detail.authorEmail': 'Correo del autor',
  'detail.pushAccount': 'Cuenta de push',
  'detail.pushAccount.notSet': 'Sin definir. Tu administrador de credenciales elige la cuenta.',
  'detail.remotes': 'Remotos',
  'detail.remotes.none': 'Todavía no hay remotos',
  'detail.notSet': 'Sin definir',
  'detail.ssh.default': 'Clave SSH predeterminada',
  'detail.footnote': 'Elegir una cuenta aquí solo escribe en el .git/config de este proyecto.',
  'source.local': 'este proyecto',
  'source.global': 'configuración global',
  'source.system': 'configuración del sistema',
  'source.worktree': 'este worktree',
  'source.command': 'línea de comandos',
  'source.folderRule': 'regla de carpeta',
  'source.ownerRule': 'regla de propietario',
  'warning.drifted':
    'La configuración de git de este proyecto ya no coincide con la cuenta. Vuelve a elegir la cuenta para aplicarla de nuevo.',
  'warning.notSignedIn':
    'Todavía no has iniciado sesión como "{user}". Usa "Iniciar sesión" en la cuenta, o git lo pedirá la primera vez que hagas push.',
  'warning.sshNoKey':
    'El remoto "{remote}" usa SSH y esta cuenta no tiene clave SSH, así que git hace push con tu clave predeterminada, que puede ser de otra cuenta. Agrega una clave a la cuenta o cambia el remoto a HTTPS.',
  'warning.pinnedUser':
    'La URL del remoto "{remote}" está fijada al usuario "{user}", así que git hace push con ese usuario. Quita el usuario de la URL.',
  'warning.embeddedCredential':
    'La URL del remoto "{remote}" lleva una credencial escrita, y git la usa en lugar de esta cuenta. Quítala de la URL.',
  'warning.notGithub': 'El remoto "{remote}" no está en github.com, así que esta cuenta no se le aplica.',

  // Settings
  'settings.intro': 'Los cambios se aplican al instante.',
  'settings.language': 'Idioma',
  'settings.theme': 'Tema',
  'settings.theme.system': 'Igual que el sistema',
  'settings.theme.light': 'Claro',
  'settings.theme.dark': 'Oscuro',

  // Info
  'info.title': 'Acerca de Commit Hats',
  'info.system': 'Sistema',
  'info.dataFolder': 'Carpeta de datos',
  'info.dataFolder.hint':
    'Tus cuentas, tu lista de proyectos y tu configuración se guardan en la carpeta de datos. Las sesiones quedan en tu administrador de credenciales, nunca aquí.',
  'info.installed': 'Instalado',
  'info.notFound': 'No encontrado',
  'info.copy': 'Copiar versiones',

  // Guided tour
  'tour.progress': 'Paso {current} de {total}',
  'tour.skip': 'Omitir',
  'tour.back': 'Atrás',
  'tour.next': 'Siguiente',
  'tour.welcome.title': 'Un sombrero por proyecto',
  'tour.welcome.body':
    'Commit Hats hace que cada proyecto haga commit y push con la cuenta que elijas. Tu configuración global de git queda como está.',
  'tour.accounts.title': 'Tus cuentas',
  'tour.accounts.body':
    'Una cuenta es el autor de los commits y el usuario de GitHub con el que haces push. Agrega una por cada identidad con la que trabajas. La marca verde indica que esa cuenta tiene la sesión iniciada.',
  'tour.rules.title': 'Las reglas lo hacen por ti',
  'tour.rules.body':
    'En una cuenta, "Agregar carpeta" la usa en todos los repositorios de una carpeta, y "Agregar propietario" en todos los de un usuario u organización de GitHub. Eso incluye los que clones más adelante.',
  'tour.projects.title': 'Tus proyectos',
  'tour.projects.body':
    'Agrega los repositorios en los que trabajas y elige una cuenta para cada uno. Arrastra un proyecto desde los puntos de su izquierda para reordenar la lista.',
  'tour.detail.title': 'Lo que hará git',
  'tour.detail.body':
    'Para el proyecto seleccionado: quién hace commit, quién hace push y con qué clave SSH, y de dónde sale cada valor. Lo que requiera atención aparece aquí.',
  'tour.toolbar.title': 'Ayuda y configuración',
  'tour.toolbar.body':
    'Guía vuelve a abrir este recorrido. Info muestra las versiones en uso. Configuración cambia el idioma y el tema. Actualizar vuelve a leer git.',

  // Native dialogs
  'dialog.pickSshKey.title': 'Elige la clave privada SSH',
  'dialog.pickFolder.title': 'Elige la carpeta en la que se usa esta cuenta',
  'dialog.pickFolder.button': 'Elegir',
  'dialog.addProjects.title': 'Agregar carpetas de proyectos',
  'dialog.addProjects.button': 'Agregar',

  // Failures nobody chose
  'git.failed': 'Git no pudo completar la operación: {detail}',
  'error.gitNotFound': 'No se encontró Git. Instala Git y reinicia la app.',
  'error.gitTimeout': 'Git tardó demasiado en responder. Inténtalo de nuevo.',
  'error.generic': 'Algo salió mal. Inténtalo de nuevo.',
  'error.untrustedSender': 'Esta solicitud no vino de la ventana de la app.',
};
